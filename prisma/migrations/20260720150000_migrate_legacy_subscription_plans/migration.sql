-- One-time data migration. Runtime code accepts only the new modular plan keys.
UPDATE `SystemConfig`
SET `value` = JSON_SET(`value`, '$.planKey', 'hris')
WHERE `key` = 'billing.subscription'
  AND JSON_UNQUOTE(JSON_EXTRACT(`value`, '$.planKey')) = 'starter';

UPDATE `SystemConfig`
SET `value` = JSON_SET(`value`, '$.planKey', 'all-in-one')
WHERE `key` = 'billing.subscription'
  AND JSON_UNQUOTE(JSON_EXTRACT(`value`, '$.planKey')) IN ('business', 'enterprise');
