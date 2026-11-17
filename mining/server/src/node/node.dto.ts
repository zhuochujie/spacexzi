import { IsInt, IsUUID, Max, Min } from 'class-validator';
export class NodePurchaseDto {
  @IsInt() @Min(0) @Max(10000) targetLevelIndex!: number;
}
export class NodeNonceDto {
  @IsUUID() nonce!: string;
}
