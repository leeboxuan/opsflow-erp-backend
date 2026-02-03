import { PodStatus } from '@prisma/client';
export declare class CreatePodDto {
    status?: PodStatus;
    signedBy?: string;
    signedAt?: string;
    photoUrl?: string;
    signatureUrl?: string;
    note?: string;
}
