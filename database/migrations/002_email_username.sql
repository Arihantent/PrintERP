-- Usernames may be an email address, and the owner login jeet is restored
-- to the temporary password ChangeMe@123 (changed at first sign-in).
ALTER TABLE users MODIFY username VARCHAR(120) NOT NULL;

INSERT INTO users (id, username, name, password_hash, role, active, must_change_password)
VALUES (
  'u_bh_SHd58Bri5ye81Tlb_Iw',
  'jeet',
  'Jeet Shah',
  '$2a$10$fxfWQP/T1KdQxwAnF78AV.PwW1xWTYxLHyECnzWdJmC1MOC6j3U0a',
  'owner',
  1,
  1
)
ON DUPLICATE KEY UPDATE
  username='jeet',
  name='Jeet Shah',
  password_hash=VALUES(password_hash),
  role='owner',
  active=1,
  must_change_password=1;
