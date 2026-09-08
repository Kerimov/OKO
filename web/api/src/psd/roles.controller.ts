import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { getDb } from "../../../domain/src/db.js";
import {
  createRole,
  deleteRole,
  getRole,
  listPermissionsCatalog,
  listRoles,
  setRolePermissions,
  updateRole,
} from "../../../domain/src/rbac.js";
import { isPsdPermission, type PsdPermission } from "../../../domain/src/psdRoles.js";
import {
  PsdPermissionGuard,
  RequirePsdPermissions,
} from "../auth/psd-permission.guard.js";

@ApiTags("roles")
@ApiBearerAuth()
@UseGuards(PsdPermissionGuard)
@Controller()
export class RolesController {
  @Get("permissions")
  @RequirePsdPermissions("roles.manage", "users.manage", "tech.configure")
  @ApiOperation({ summary: "Каталог permissions (фиксированный, из кода)" })
  listPermissions() {
    return listPermissionsCatalog();
  }

  @Get("roles")
  @RequirePsdPermissions("roles.manage", "users.manage", "tech.configure")
  @ApiOperation({ summary: "Список ролей" })
  async list() {
    return listRoles(await getDb());
  }

  @Get("roles/:code")
  @RequirePsdPermissions("roles.manage", "users.manage", "tech.configure")
  async get(@Param("code") code: string) {
    const role = await getRole(await getDb(), code);
    if (!role) throw new NotFoundException({ error: "Not found" });
    return role;
  }

  @Post("roles")
  @HttpCode(201)
  @RequirePsdPermissions("roles.manage", "tech.configure")
  @ApiOperation({ summary: "Создать кастомную роль" })
  async create(
    @Body()
    body: {
      code: string;
      nameRu: string;
      nameEn?: string | null;
      permissions?: string[];
      active?: boolean;
    }
  ) {
    try {
      const permissions = (body.permissions ?? []).filter(isPsdPermission);
      return await createRole(await getDb(), {
        code: body.code,
        nameRu: body.nameRu,
        nameEn: body.nameEn,
        permissions,
        active: body.active,
      });
    } catch (e) {
      throw new BadRequestException({
        error: e instanceof Error ? e.message : "create failed",
      });
    }
  }

  @Put("roles/:code")
  @RequirePsdPermissions("roles.manage", "tech.configure")
  @ApiOperation({ summary: "Обновить имя/active роли" })
  async update(
    @Param("code") code: string,
    @Body() body: { nameRu?: string; nameEn?: string | null; active?: boolean }
  ) {
    try {
      return await updateRole(await getDb(), code, body);
    } catch (e) {
      throw new BadRequestException({
        error: e instanceof Error ? e.message : "update failed",
      });
    }
  }

  @Put("roles/:code/permissions")
  @RequirePsdPermissions("roles.manage", "tech.configure")
  @ApiOperation({ summary: "Задать набор permissions роли" })
  async setPermissions(
    @Param("code") code: string,
    @Body() body: { permissions: string[] }
  ) {
    try {
      const permissions = (body.permissions ?? []).filter(isPsdPermission) as PsdPermission[];
      if (!Array.isArray(body.permissions)) {
        throw new Error("permissions must be an array");
      }
      if (body.permissions.some((p) => !isPsdPermission(p))) {
        throw new Error("unknown permission in list");
      }
      return await setRolePermissions(await getDb(), code, permissions);
    } catch (e) {
      throw new BadRequestException({
        error: e instanceof Error ? e.message : "update permissions failed",
      });
    }
  }

  @Delete("roles/:code")
  @HttpCode(204)
  @RequirePsdPermissions("roles.manage", "tech.configure")
  @ApiOperation({ summary: "Удалить кастомную роль (без пользователей)" })
  async remove(@Param("code") code: string) {
    try {
      await deleteRole(await getDb(), code);
    } catch (e) {
      throw new BadRequestException({
        error: e instanceof Error ? e.message : "delete failed",
      });
    }
  }
}
