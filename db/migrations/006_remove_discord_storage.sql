BEGIN;

-- Discord保存時代の添付は新しいオブジェクトキーを持たないため、
-- 廃止した保存先の参照を残さないよう削除する。
DELETE FROM public.attachments WHERE object_key IS NULL;

ALTER TABLE public.attachments
  ALTER COLUMN object_key SET NOT NULL;

DROP INDEX IF EXISTS public.attachments_discord_message_id_idx;

ALTER TABLE public.attachments
  DROP CONSTRAINT IF EXISTS attachments_discord_channel_id_discord_message_id_key,
  DROP COLUMN IF EXISTS discord_channel_id,
  DROP COLUMN IF EXISTS discord_message_id,
  DROP COLUMN IF EXISTS discord_attachment_id;

COMMIT;
