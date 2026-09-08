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
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { getDb } from "../../../domain/src/db.js";
import {
  createRole,
  deleteRole,
  getRole,
  listPermissionsCatalog,
  listRoleDirectory,
  listRoles,
  assignUserToRole,
  removeUserFromRole,
  setRolePermissions,
  updateRole,
} from "../../../domain/src/rbac.js";
import { isPsdPermission, type PsdPermission } from "../../../domain/src/psdRoles.js";
import {
  PsdPermissionGuard,
  RequirePsdPermissions,
} from "../auth/psd-permission.guard.js";
import {
  AddRoleMemberDto,
  CreateRoleDto,
  SetRolePermissionsDto,
  UpdateRoleDto,
} from "./dto/roles.dto.js";

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

  @Get("role-directory")
  @RequirePsdPermissions("roles.manage", "users.manage", "tech.configure")
  @ApiOperation({ summary: "Справочник пользователей для назначения ролей" })
  async directory() {
    return listRoleDirectory(await getDb());
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

  @Post("roles/:code/members")
  @HttpCode(200)
  @RequirePsdPermissions("roles.manage", "users.manage", "tech.configure")
  @ApiOperation({ summary: "Добавить пользователя в роль" })
  async addMember(@Param("code") code: string, @Body() body: AddRoleMemberDto) {
    const userId = Number(body.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      throw new BadRequestException({ error: "userId required" });
    }
    try {
      return await assignUserToRole(await getDb(), code, userId);
    } catch (e) {
      throw new BadRequestException({
        error: e instanceof Error ? e.message : "assign failed",
      });
    }
  }

  @Delete("roles/:code/members/:userId")
  @RequirePsdPermissions("roles.manage", "users.manage", "tech.configure")
  @ApiOperation({ summary: "Убрать пользователя из роли (переназначить на другую)" })
  async removeMember(
    @Param("code") code: string,
    @Param("userId") userIdRaw: string,
    @Query("toRole") toRole?: string
  ) {
    const userId = Number(userIdRaw);
    if (!Number.isFinite(userId) || userId <= 0) {
      throw new BadRequestException({ error: "invalid userId" });
    }
    try {
      return await removeUserFromRole(await getDb(), code, userId, toRole);
    } catch (e) {
      throw new BadRequestException({
        error: e instanceof Error ? e.message : "remove failed",
      });
    }
  }

  @Post("roles")
  @HttpCode(201)
  @RequirePsdPermissions("roles.manage", "tech.configure")
  @ApiOperation({ summary: "Создать кастомную роль" })
  async create(@Body() body: CreateRoleDto) {
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
  async update(@Param("code") code: string, @Body() body: UpdateRoleDto) {
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
    @Body() body: SetRolePermissionsDto
  ) {
    try {
      const permissions = body.permissions.filter(isPsdPermission) as PsdPermission[];
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
