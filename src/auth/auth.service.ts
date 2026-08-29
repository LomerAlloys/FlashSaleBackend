import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  generateToken(userId: string) {
    const payload = { sub: userId };
    const token = this.jwtService.sign(payload);
    return {
      status: 'success',
      accessToken: token,
    };
  }
}
