ALTER TABLE `User`
  ADD COLUMN `isPlatformAdmin` BOOLEAN NOT NULL DEFAULT false;

UPDATE `User` user_record
INNER JOIN `Organization` organization_record
  ON organization_record.`id` = user_record.`organizationId`
SET user_record.`isPlatformAdmin` = true
WHERE organization_record.`slug` = 'default'
  AND user_record.`email` = (
    SELECT organization_email.`email`
    FROM `Organization` organization_email
    WHERE organization_email.`id` = user_record.`organizationId`
  );

CREATE INDEX `User_isPlatformAdmin_isActive_idx`
  ON `User`(`isPlatformAdmin`, `isActive`);
