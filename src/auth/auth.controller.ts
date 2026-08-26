import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('token')
  getToken(@Body() body: { userId: string }) {
    if (!body || !body.userId) {
      throw new BadRequestException('userId is required');
    }
    return this.authService.generateToken(body.userId);
  }
}
