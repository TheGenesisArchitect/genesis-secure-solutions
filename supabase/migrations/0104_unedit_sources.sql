-- Helix Newsroom: the approved sources sheet on a recording (lib/unedit-news.ts). Each entry is a fact the episode
-- shows on screen (a source chip, an attributed quote, a timeline or a ticker) tied to the words the speaker says
-- when it should appear. Staff set it on the card; the episode's graphics place it where those words are said.
alter table unedit_vlogs add column if not exists sources jsonb;
