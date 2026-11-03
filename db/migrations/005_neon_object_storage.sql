BEGIN;

ALTER TABLE public.attachments
  ADD COLUMN IF NOT EXISTS object_key TEXT;

ALTER TABLE public.attachments
  ALTER COLUMN discord_channel_id DROP NOT NULL,
  ALTER COLUMN discord_message_id DROP NOT NULL,
  ALTER COLUMN discord_attachment_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS attachments_object_key_idx
  ON public.attachments (object_key)
  WHERE object_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS attachments_discord_message_id_idx
  ON public.attachments (discord_message_id)
  WHERE discord_message_id IS NOT NULL;

COMMIT;
