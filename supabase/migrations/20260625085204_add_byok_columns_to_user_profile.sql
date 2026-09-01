alter table user_profile
  add column if not exists ai_api_key_cipher text,
  add column if not exists ai_chat_model text,
  add column if not exists ai_review_model text;
