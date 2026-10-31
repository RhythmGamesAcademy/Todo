-- 既存DB向け 通知・タグ・申請(承認/否認) 追加マイグレーション。
-- 前提: db/schema.sql を適用済みのDB向け。
-- 再実行可能なため、検証環境で確認後に本番DBへ同じコマンドを実行する。

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS notification_read_at TIMESTAMPTZ;

ALTER TABLE public.todos
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

-- 承認状態は「申請」タグの有無にのみ連動する。タグが付く=pending 開始、
-- 外れる=NULL(未申請)。理由・決裁者・時刻は承認/否認の実行で埋まる。
ALTER TABLE public.todos
  ADD COLUMN IF NOT EXISTS approval_status TEXT;
ALTER TABLE public.todos
  ADD COLUMN IF NOT EXISTS approval_reason TEXT;
ALTER TABLE public.todos
  ADD COLUMN IF NOT EXISTS approval_by UUID REFERENCES public.users(id)
    ON DELETE SET NULL;
ALTER TABLE public.todos
  ADD COLUMN IF NOT EXISTS approval_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'todos_approval_status_check'
  ) THEN
    ALTER TABLE public.todos
      ADD CONSTRAINT todos_approval_status_check
      CHECK (approval_status IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.notifications (
  id         UUID PRIMARY KEY,
  list_id    UUID NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  actor_id   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  todo_id    UUID REFERENCES public.todos(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS notifications_list_user_created_idx
  ON public.notifications (list_id, user_id, created_at);
CREATE INDEX IF NOT EXISTS notifications_todo_id_idx
  ON public.notifications (todo_id);

-- 変更履歴に申請の承認/否認を残すため kind の CHECK 制約を作り直す。
ALTER TABLE public.activities
  DROP CONSTRAINT IF EXISTS activities_kind_check;
ALTER TABLE public.activities
  ADD CONSTRAINT activities_kind_check CHECK (
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
  );

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
  ELSIF TG_TABLE_NAME = 'notifications' THEN
    target_list_id := CASE
      WHEN TG_OP = 'DELETE' THEN OLD.list_id
      ELSE NEW.list_id
    END;
  ELSIF TG_OP = 'DELETE' THEN
    target_list_id := OLD.list_id;
  ELSE
    target_list_id := NEW.list_id;
  END IF;
  UPDATE public.lists SET revision = revision + 1 WHERE id = target_list_id;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notifications_bump_revision ON public.notifications;
CREATE TRIGGER notifications_bump_revision
AFTER INSERT OR UPDATE OR DELETE ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.bump_list_revision();

COMMIT;
