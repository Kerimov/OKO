import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import {
  buildAuthMePayload,
  getOidcConfig,
  hasUserAccounts,
  loginWithCredentials,
  logoutAllSessions,
  logoutSession,
} from "../../../server/src/auth.js";
import { sessionTtlMs, maxSessionsPerUser } from "../../../server/src/users.js";
import { getDb } from "../../../server/src/db.js";
import {
  beginOidcState,
  completeOidcLogin,
  getOidcRuntimeConfig,
} from "../../../server/src/oidc.js";
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
  @Get("oidc/config")
  @ApiOperation({ summary: "Публичная конфигурация OIDC" })
  oidcConfig() {
    const cfg = getOidcConfig();
    const runtime = getOidcRuntimeConfig();
    return {
      enabled: cfg.enabled,
      issuer: cfg.issuer,
      clientId: cfg.clientId,
      authorizationUrl: cfg.authorizationUrl,
      scopes: cfg.scopes,
      callbackPath: cfg.callbackPath,
      hasClientSecret: !!runtime.clientSecret,
      status: cfg.enabled
        ? runtime.clientSecret
          ? "ready"
          : "configured (set OKO_OIDC_CLIENT_SECRET for confidential clients)"
        : "disabled — set OKO_OIDC_ISSUER + OKO_OIDC_CLIENT_ID",
    };
  }

  @Public()
  @Get("oidc/start")
  @ApiOperation({ summary: "URL авторизации IdP + state" })
  oidcStart(@Req() req: Request) {
    const cfg = getOidcConfig();
    if (!cfg.enabled || !cfg.authorizationUrl || !cfg.clientId) {
      throw new BadRequestException({ error: "OIDC is not configured" });
    }
    const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const redirectUri = `${proto}://${host}${cfg.callbackPath}`;
    const state = beginOidcState(redirectUri);
    const url = new URL(cfg.authorizationUrl);
    url.searchParams.set("client_id", cfg.clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", cfg.scopes.join(" "));
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    return { authorizationUrl: url.toString(), redirectUri, state };
  }

  @Public()
  @Get("oidc/callback")
  @ApiOperation({ summary: "OIDC callback: code → session → redirect с sso_token" })
  async oidcCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Query("code") code?: string,
    @Query("state") state?: string,
    @Query("error") error?: string,
    @Query("error_description") errorDescription?: string
  ) {
    const runtime = getOidcRuntimeConfig();
    const appBase = (runtime.publicAppUrl || "http://localhost:5173").replace(/\/$/, "");

    if (error) {
      const fail = new URL(appBase + "/login");
      fail.searchParams.set("sso_error", errorDescription || error);
      return res.redirect(fail.toString());
    }
    if (!code?.trim() || !state?.trim()) {
      throw new BadRequestException({ error: "code and state required" });
    }

    const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const callbackAbsoluteUrl = `${proto}://${host}${runtime.callbackPath}`;

    try {
      const result = await completeOidcLogin(await getDb(), {
        code: code.trim(),
        state: state.trim(),
        callbackAbsoluteUrl,
      });
      return res.redirect(result.appRedirect);
    } catch (e) {
      const fail = new URL(appBase + "/login");
      fail.searchParams.set(
        "sso_error",
        e instanceof Error ? e.message : "OIDC login failed"
      );
      return res.redirect(fail.toString());
    }
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

  @Post("logout-all")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Выход со всех устройств (все сессии пользователя)" })
  async logoutAll(@Req() req: Request) {
    const result = await logoutAllSessions(req);
    return { ok: true as const, ...result };
  }

  @Public()
  @Get("session-policy")
  @ApiOperation({ summary: "Публичные параметры TTL сессий" })
  sessionPolicy() {
    return {
      ttlMs: sessionTtlMs(),
      ttlHours: Math.round(sessionTtlMs() / 3_600_000),
      maxPerUser: maxSessionsPerUser(),
    };
  }
}
