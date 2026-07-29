-- AlterTable
ALTER TABLE `AgentInvitation`
  ADD COLUMN `roleId` VARCHAR(191) NULL,
  ADD COLUMN `invitedByUserId` VARCHAR(191) NULL,
  ADD COLUMN `moduleAccess` JSON NULL;

-- CreateIndex
CREATE INDEX `AgentInvitation_organizationId_roleId_idx` ON `AgentInvitation`(`organizationId`, `roleId`);

-- AddForeignKey
ALTER TABLE `AgentInvitation`
  ADD CONSTRAINT `AgentInvitation_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AgentInvitation`
  ADD CONSTRAINT `AgentInvitation_invitedByUserId_fkey` FOREIGN KEY (`invitedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
