declare module "ae-api" {
  export type Environment = "prod" | "sandbox";

  export interface TokenResponse {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    refresh_token_timeout: number;
    user_id: string;
  }

  export interface ApiResponse<T = any> {
    result: T;
    error_code?: string;
    error_message?: string;
  }

  export class AeClient {
    constructor(
      env: Environment,
      appKey: string,
      appSecret: string,
      accessToken?: string
    );

    getAuthorizeUrl(redirectUri: string): string;

    getAcessTokenByCode(code: string): Promise<TokenResponse>;

    getAccessTokenByRefreshToken(refreshToken: string): Promise<TokenResponse>;

    doAuthenticateRequest<T = any>(
      apiName: string,
      params: Record<string, any>
    ): Promise<ApiResponse<T>>;
  }
}
