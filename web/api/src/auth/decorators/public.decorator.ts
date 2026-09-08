import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "okoPublic";

/** Route доступен без Bearer-токена (как PUBLIC_API_PATHS в legacy). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
