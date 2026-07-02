import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableCors({
    origin: (process.env.WEB_WALLET_ORIGIN ?? 'http://localhost:3001').split(','),
    credentials: false,
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
