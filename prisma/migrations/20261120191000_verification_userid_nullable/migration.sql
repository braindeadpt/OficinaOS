-- Better Auth grava valores de verificação (desafios 2FA, tokens) sem
-- userId — a coluna era NOT NULL por costume, o que falhava os inserts do
-- plugin. Passa a opcional; o cascade mantém-se quando definido.

ALTER TABLE "verifications" ALTER COLUMN "userId" DROP NOT NULL;
