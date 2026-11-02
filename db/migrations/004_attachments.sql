-- 既存DB向け 添付ファイル(Discord CDN保存)追加マイグレーション。
-- 前提: db/migrations/003_multiple_assignees.sql まで適用済みのDB向け。
-- 再実行可能なため、検証環境で確認後に本番DBへ同じコマンドを実行する。

BEGIN;

-- メモ単位の添付が対象TODOに所属することを複合外部キーで保証するため、
-- (id, todo_id) の複合UNIQUE制約を追加する。
ALTER TABLE public.memos
  ADD CONSTRAINT memos_id_todo_id_unique UNIQUE (id, todo_id);

-- ファイル本体はDiscord CDNに置き、NeonにはDiscord上の識別情報とメタデータ
-- だけを保存する。Discordの署名付きURLは期限が変わるため永続保存しない。
-- memo_id が NULL のときはTODO単位の添付、UUID のときはメモ単位の添付。
-- (memo_id, todo_id) の複合外部キーで、メモが対象TODOに所属することを保証する。
CREATE TABLE IF NOT EXISTS public.attachments (
  id          UUID PRIMARY KEY,
  todo_id     UUID NOT NULL REFERENCES public.todos(id) ON DELETE CASCADE,
  memo_id     UUID,
  discord_channel_id TEXT NOT NULL,
  discord_message_id TEXT NOT NULL,
  discord_attachment_id TEXT NOT NULL,
  filename    TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes  BIGINT NOT NULL CHECK (size_bytes > 0),
  created_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (discord_channel_id, discord_message_id),
  FOREIGN KEY (memo_id, todo_id)
    REFERENCES public.memos (id, todo_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS attachments_todo_id_idx
  ON public.attachments (todo_id);
CREATE INDEX IF NOT EXISTS attachments_memo_id_idx
  ON public.attachments (memo_id);
CREATE INDEX IF NOT EXISTS attachments_discord_message_id_idx
  ON public.attachments (discord_message_id);

-- 変更のたびに lists.revision を進める既存トリガー関数に attachments を追加する。
-- 添付の追加・削除だけを対象とし、URLの再取得では revision を進めない。
CREATE OR REPLACE FUNCTION public.bump_list_revision() RETURNS trigger AS $$
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
    WHERE t.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.todo_id ELSE NEW.todo_id END;
  ELSIF TG_OP = 'DELETE' THEN
    target_list_id := OLD.list_id;
  ELSE
    target_list_id := NEW.list_id;
  END IF;
  UPDATE public.lists SET revision = revision + 1 WHERE id = target_list_id;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER attachments_bump_revision
AFTER INSERT OR UPDATE OR DELETE ON attachments
FOR EACH ROW EXECUTE FUNCTION bump_list_revision();

COMMIT;
