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
  assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE memos (
  id         UUID PRIMARY KEY,
  todo_id    UUID NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  body       TEXT NOT NULL,
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
      'list.renamed'
    )
  ),
  field      TEXT,
  before     TEXT,
  after      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX todos_list_id_idx ON todos (list_id);
CREATE INDEX todos_active_idx ON todos (list_id, deleted_at);
CREATE INDEX memos_todo_id_idx ON memos (todo_id);
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

CREATE TRIGGER users_bump_revision
AFTER INSERT OR UPDATE OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION bump_list_revision();

CREATE TRIGGER activities_bump_revision
AFTER INSERT OR UPDATE OR DELETE ON activities
FOR EACH ROW EXECUTE FUNCTION bump_list_revision();
