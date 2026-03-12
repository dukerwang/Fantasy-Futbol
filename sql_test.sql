-- 1. Create a commissioner user
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change) 
VALUES (gen_random_uuid(), 'bot_commish@fantasyfutbol.test', 'fakehash', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
ON CONFLICT (email) DO NOTHING
RETURNING id;
