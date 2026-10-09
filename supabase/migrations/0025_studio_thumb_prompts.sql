-- Each episode carries its key-art idea for thumbnails (editable before each generation).
alter table studio_episodes add column if not exists thumb_prompt text;
