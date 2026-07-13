import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { refreshUserAccountsCache } from "../../../server/src/auth.js";
import { getDb } from "../../../server/src/db.js";
import { createUser, listUsers, updateUser } from "../../../server/src/users.js";
import { AdminGuard } from "../auth/admin.guard.js";
import { CreateUserDto, UpdateUserDto } from "../packages/dto/packages.dto.js";

@ApiTags("users")
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller("users")
export class UsersController {
  @Get()
  @ApiOperation({ summary: "Список пользователей (admin)" })
  async list() {
    return listUsers(await getDb());
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: "Создать пользователя (admin)" })
  async create(@Body() body: CreateUserDto) {
    try {
      const user = await createUser(await getDb(), {
        username: body.username,
        password: body.password,
        displayName: body.displayName,
        role: body.role ?? "org",
        zid: body.zid,
      });
      await refreshUserAccountsCache();
      return user;
    } catch (e) {
      throw new BadRequestException({
        error: e instanceof Error ? e.message : "create failed",
      });
    }
  }

  @Put(":id")
  @ApiOperation({ summary: "Обновить пользователя (admin)" })
  async update(@Param("id") idRaw: string, @Body() body: UpdateUserDto) {
    const id = Number(idRaw);
    if (!Number.isFinite(id)) {
      throw new BadRequestException({ error: "invalid id" });
    }
    try {
      const user = await updateUser(await getDb(), id, body);
      if (!user) {
        throw new NotFoundException({ error: "Not found" });
      }
      return user;
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      throw new BadRequestException({
        error: e instanceof Error ? e.message : "update failed",
      });
    }
  }
}
