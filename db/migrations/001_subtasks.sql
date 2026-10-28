-- 既存DB向けサブタスク追加マイグレーション。
-- 前提: db/schema.sql で lists・todos などの基礎スキーマを適用済み。
-- 再実行可能なため、検証環境で確認後に本番DBへ同じコマンドを実行する。

BEGIN;

CREATE TABLE IF NOT EXISTS public.subtasks (
  id          UUID PRIMARY KEY,
  todo_id     UUID NOT NULL REFERENCES public.todos(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('todo', 'done')),
  priority    TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
  due         TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.subtask_memos (
  id          UUID PRIMARY KEY,
  subtask_id  UUID NOT NULL REFERENCES public.subtasks(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subtasks_todo_id_idx
  ON public.subtasks (todo_id);
CREATE INDEX IF NOT EXISTS subtask_memos_subtask_id_idx
  ON public.subtask_memos (subtask_id);
CREATE INDEX IF NOT EXISTS subtask_memos_created_at_idx
  ON public.subtask_memos (created_at);

CREATE OR REPLACE FUNCTION public.bump_list_revision() RETURNS trigger AS $$
DECLARE
  target_list_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'memos' THEN
    SELECT t.list_id INTO target_list_id
    FROM public.todos t
    WHERE t.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.todo_id ELSE NEW.todo_id END;
  ELSIF TG_TABLE_NAME = 'subtask_memos' THEN
    SELECT t.list_id INTO target_list_id
    FROM public.subtasks s
    JOIN public.todos t ON t.id = s.todo_id
    WHERE s.id = CASE
      WHEN TG_OP = 'DELETE' THEN OLD.subtask_id
      ELSE NEW.subtask_id
    END;
  ELSIF TG_TABLE_NAME = 'subtasks' THEN
    SELECT t.list_id INTO target_list_id
    FROM public.todos t
    WHERE t.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.todo_id ELSE NEW.todo_id END;
  ELSIF TG_OP = 'DELETE' THEN
    target_list_id := OLD.list_id;
  ELSE
    target_list_id := NEW.list_id;
  END IF;
  UPDATE public.lists SET revision = revision + 1 WHERE id = target_list_id;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS subtasks_bump_revision ON public.subtasks;
CREATE TRIGGER subtasks_bump_revision
AFTER INSERT OR UPDATE OR DELETE ON public.subtasks
FOR EACH ROW EXECUTE FUNCTION public.bump_list_revision();

DROP TRIGGER IF EXISTS subtask_memos_bump_revision ON public.subtask_memos;
CREATE TRIGGER subtask_memos_bump_revision
AFTER INSERT OR UPDATE OR DELETE ON public.subtask_memos
FOR EACH ROW EXECUTE FUNCTION public.bump_list_revision();

COMMIT;
