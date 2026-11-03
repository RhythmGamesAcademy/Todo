-- 共有リスト版のスキーマ。
-- 適用: psql "$DATABASE_URL" -f db/schema.sql

CREATE TABLE lists (
  id          UUID PRIMARY KEY,
  token       TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  revision    BIGINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id          UUID PRIMARY KEY,
  list_id     UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  notification_read_at TIMESTAMPTZ,
  UNIQUE (list_id, name)
);

CREATE TABLE todos (
  id          UUID PRIMARY KEY,
  list_id     UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL CHECK (status IN ('todo', 'doing', 'done')),
  priority    TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
  due         TIMESTAMPTZ,
  deleted_at  TIMESTAMPTZ,
  -- 担当者は複数。空配列 = 未割り当て。単数時代の assignee_id は
  -- db/migrations/003_multiple_assignees.sql で引き継ぐ。
  assignee_ids UUID[] NOT NULL DEFAULT '{}',
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  tags        TEXT[] NOT NULL DEFAULT '{}',
  approval_status TEXT CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  approval_reason TEXT,
  approval_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  approval_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE subtasks (
  id          UUID PRIMARY KEY,
  todo_id     UUID NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('todo', 'done')),
  priority    TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
  due         TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE subtask_memos (
  id          UUID PRIMARY KEY,
  subtask_id  UUID NOT NULL REFERENCES subtasks(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE memos (
  id         UUID PRIMARY KEY,
  todo_id    UUID NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- メモ単位の添付が対象TODOに所属することを複合外部キーで保証するための
  -- 複合UNIQUE。(id, todo_id) を新規作成用のスキーマにも反映する。
  UNIQUE (id, todo_id)
);

-- 新規ファイル本体はNeon Object Storageに置き、DBにはオブジェクトキーと
-- メタデータだけを保存する。既存Discord添付の識別情報も互換用に保持する。
-- memo_id が NULL のときはTODO単位の添付、UUID のときはメモ単位の添付。
CREATE TABLE attachments (
  id          UUID PRIMARY KEY,
  todo_id     UUID NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  memo_id     UUID,
  object_key TEXT,
  discord_channel_id TEXT,
  discord_message_id TEXT,
  discord_attachment_id TEXT,
  filename    TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes  BIGINT NOT NULL CHECK (size_bytes > 0),
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (discord_channel_id, discord_message_id),
  UNIQUE (object_key),
  -- メモが対象TODOに所属することを複合外部キーで保証する。
  FOREIGN KEY (memo_id, todo_id) REFERENCES memos (id, todo_id) ON DELETE CASCADE
);

-- 自分宛の通知。user_id は宛先、actor_id は操作者。
CREATE TABLE notifications (
  id         UUID PRIMARY KEY,
  list_id    UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  todo_id    UUID REFERENCES todos(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (
    kind IN (
      'mention',
      'todo.assigned',
      'approval.approved',
      'approval.rejected'
    )
  ),
  body       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE activities (
  id         UUID PRIMARY KEY,
  list_id    UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  todo_id    UUID REFERENCES todos(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL CHECK (
    kind IN (
      'todo.created',
      'todo.updated',
      'todo.deleted',
      'todo.restored',
      'user.joined',
      'user.renamed',
      'user.removed',
      'list.renamed',
      'approval.approved',
      'approval.rejected'
    )
  ),
  field      TEXT,
  before     TEXT,
  after      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX todos_list_id_idx ON todos (list_id);
CREATE INDEX todos_active_idx ON todos (list_id, deleted_at);
CREATE INDEX attachments_todo_id_idx ON attachments (todo_id);
CREATE INDEX attachments_memo_id_idx ON attachments (memo_id);
CREATE INDEX attachments_discord_message_id_idx ON attachments (discord_message_id);
CREATE INDEX subtasks_todo_id_idx ON subtasks (todo_id);
CREATE INDEX subtask_memos_subtask_id_idx ON subtask_memos (subtask_id);
CREATE INDEX subtask_memos_created_at_idx ON subtask_memos (created_at);
CREATE INDEX memos_todo_id_idx ON memos (todo_id);
CREATE INDEX notifications_list_user_created_idx
  ON notifications (list_id, user_id, created_at);
CREATE INDEX notifications_todo_id_idx ON notifications (todo_id);
CREATE INDEX activities_list_created_idx ON activities (list_id, created_at);
CREATE INDEX activities_todo_id_idx ON activities (todo_id);
CREATE INDEX users_list_id_idx ON users (list_id);

-- 書き込みのたびに lists.revision を進める。memos は list_id を持たないため
-- todo 経由で対象リストを解決する。重複加算は許容(単調増加であればよい)。
CREATE OR REPLACE FUNCTION bump_list_revision() RETURNS trigger AS $$
DECLARE
  target_list_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'memos' THEN
    SELECT t.list_id INTO target_list_id
    FROM todos t
    WHERE t.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.todo_id ELSE NEW.todo_id END;
  ELSIF TG_TABLE_NAME = 'subtask_memos' THEN
    SELECT t.list_id INTO target_list_id
    FROM subtasks s
    JOIN todos t ON t.id = s.todo_id
    WHERE s.id = CASE
      WHEN TG_OP = 'DELETE' THEN OLD.subtask_id
      ELSE NEW.subtask_id
    END;
  ELSIF TG_TABLE_NAME = 'subtasks' THEN
    SELECT t.list_id INTO target_list_id
    FROM todos t
    WHERE t.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.todo_id ELSE NEW.todo_id END;
  ELSIF TG_TABLE_NAME = 'notifications' THEN
    target_list_id := CASE
      WHEN TG_OP = 'DELETE' THEN OLD.list_id
      ELSE NEW.list_id
    END;
  ELSIF TG_TABLE_NAME = 'attachments' THEN
    SELECT t.list_id INTO target_list_id
    FROM todos t
    WHERE t.id = CASE
      WHEN TG_OP = 'DELETE' THEN OLD.todo_id
      ELSE NEW.todo_id
    END;
  ELSIF TG_OP = 'DELETE' THEN
    target_list_id := OLD.list_id;
  ELSE
    target_list_id := NEW.list_id;
  END IF;
  UPDATE public.lists SET revision = revision + 1 WHERE id = target_list_id;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER todos_bump_revision
AFTER INSERT OR UPDATE OR DELETE ON todos
FOR EACH ROW EXECUTE FUNCTION bump_list_revision();

CREATE TRIGGER memos_bump_revision
AFTER INSERT OR UPDATE OR DELETE ON memos
FOR EACH ROW EXECUTE FUNCTION bump_list_revision();

CREATE TRIGGER subtasks_bump_revision
AFTER INSERT OR UPDATE OR DELETE ON subtasks
FOR EACH ROW EXECUTE FUNCTION bump_list_revision();

CREATE TRIGGER subtask_memos_bump_revision
AFTER INSERT OR UPDATE OR DELETE ON subtask_memos
FOR EACH ROW EXECUTE FUNCTION bump_list_revision();

CREATE TRIGGER notifications_bump_revision
AFTER INSERT OR UPDATE OR DELETE ON notifications
FOR EACH ROW EXECUTE FUNCTION bump_list_revision();

CREATE TRIGGER users_bump_revision
AFTER INSERT OR UPDATE OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION bump_list_revision();

CREATE TRIGGER attachments_bump_revision
AFTER INSERT OR UPDATE OR DELETE ON attachments
FOR EACH ROW EXECUTE FUNCTION bump_list_revision();

CREATE TRIGGER activities_bump_revision
AFTER INSERT OR UPDATE OR DELETE ON activities
FOR EACH ROW EXECUTE FUNCTION bump_list_revision();
