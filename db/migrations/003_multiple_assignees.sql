-- 既存DB向け 複数担当者 追加マイグレーション。
-- 前提: db/migrations/002_notifications_tags.sql まで適用済みのDB向け。
-- 再実行可能なため、検証環境で確認後に本番DBへ同じコマンドを実行する。

BEGIN;

-- 担当者を単数列 assignee_id から複数列 assignee_ids (UUID[]) へ置き換える。
-- 既存の単数担当は配列の1件として引き継ぐ。
ALTER TABLE public.todos
  ADD COLUMN IF NOT EXISTS assignee_ids UUID[] NOT NULL DEFAULT '{}';

UPDATE public.todos
  SET assignee_ids = ARRAY[assignee_id]
  WHERE assignee_id IS NOT NULL
    AND assignee_ids = '{}';

ALTER TABLE public.todos
  DROP COLUMN IF EXISTS assignee_id;

COMMIT;
