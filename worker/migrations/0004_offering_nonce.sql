ALTER TABLE offerings ADD COLUMN nonce TEXT;
CREATE UNIQUE INDEX idx_offerings_nonce ON offerings (nonce) WHERE nonce IS NOT NULL;
