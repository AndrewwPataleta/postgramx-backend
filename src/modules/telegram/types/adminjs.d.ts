declare module 'adminjs/lib/frontend/hooks/use-translation.js' {
  type TranslateFunction = (
    key: string,
    resourceId?: string,
    options?: any,
  ) => string;

  export function useTranslation(): {
    translateLabel: TranslateFunction;
    translateAction: TranslateFunction;
    translateProperty: TranslateFunction;
  };
}

declare module 'adminjs/lib/frontend/hooks/use-current-admin.js' {
  type CurrentAdmin = Record<string, any> | null;

  export function useCurrentAdmin(): [
    CurrentAdmin,
    (admin: CurrentAdmin) => void,
  ];
}
