import { ConsoleLogger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as packageJson from '../package.json';
import { AppModule } from './app.module';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

// In production every log entry is one JSON line, so a multi-line stack trace
// stays a single entry instead of being split up and interleaved by the log
// collector.
const logger = new ConsoleLogger({
  json: process.env.NODE_ENV === 'production',
});

// Log the reason through the same logger before the process dies.
function exitOnFatalError(reason: string) {
  return (err: unknown) => {
    logger.error(
      `${reason}: ${err instanceof Error ? err.message : String(err)}`,
      err instanceof Error ? err.stack : undefined,
      'Process',
    );
    process.exit(1);
  };
}

process.on('uncaughtException', exitOnFatalError('Uncaught exception'));
process.on('unhandledRejection', exitOnFatalError('Unhandled rejection'));

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: logger });
  app.enableShutdownHooks();
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  // setup swagger
  const config = new DocumentBuilder()
    .setTitle('Hyperion')
    .setVersion(packageJson.version)
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.listen(3000);
}

bootstrap().catch(exitOnFatalError('Failed to start the app'));
