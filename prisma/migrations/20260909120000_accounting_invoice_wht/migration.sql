ALTER TABLE `Invoice`
  ADD COLUMN `whtApplicable` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `whtRate` DECIMAL(5,2) NULL,
  ADD COLUMN `whtAmount` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN `amountPayable` DECIMAL(14,2) NOT NULL DEFAULT 0.00;

UPDATE `Invoice`
SET `amountPayable` = `total`
WHERE `amountPayable` = 0.00;
