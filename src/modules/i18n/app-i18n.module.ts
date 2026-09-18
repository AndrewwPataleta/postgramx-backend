import { Module } from '@nestjs/common';
import {
  AcceptLanguageResolver,
  I18nJsonLoader,
  I18nModule,
} from 'nestjs-i18n';
import { join } from 'path';

@Module({
  imports: [
    I18nModule.forRoot({
      fallbackLanguage: 'en',
      loader: I18nJsonLoader,
      loaderOptions: {
        path: join(process.cwd(), 'src/i18n'),
        watch: true,
      },
      resolvers: [
        {
          use: AcceptLanguageResolver,
          options: { matchType: 'strict-loose' },
        },
      ],
    }),
  ],
  exports: [I18nModule],
})
export class AppI18nModule {}
