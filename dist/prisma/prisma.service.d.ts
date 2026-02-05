import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
declare const PrismaClient: any;
export declare class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    onModuleInit(): Promise<void>;
    onModuleDestroy(): Promise<void>;
}
export {};
