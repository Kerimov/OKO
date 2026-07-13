import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import {
  buildAuthMePayload,
  hasUserAccounts,
  loginWithCredentials,
  logoutSession,
} from "../../../server/src/auth.js";
import { LoginDto } from "./dto/login.dto.js";
import { Public } from "./decorators/public.decorator.js";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  @Public()
  @Get("me")
  @ApiOperation({ summary: "Текущий пользователь и режим авторизации" })
  me(@Req() req: Request) {
    return buildAuthMePayload(req);
  }

  @Public()
  @Post("login")
  @ApiOperation({ summary: "Вход по логину и паролю" })
  async login(@Body() dto: LoginDto) {
    if (!hasUserAccounts()) {
      throw new BadRequestException({ error: "User accounts are not enabled" });
    }
    const result = await loginWithCredentials(dto.username.trim(), dto.password);
    if (!result) {
      throw new UnauthorizedException({ error: "Invalid username or password" });
    }
    return result;
  }

  @Post("logout")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Выход (инвалидация сессии)" })
  async logout(@Req() req: Request) {
    await logoutSession(req);
    return { ok: true as const };
  }
}
