import axios, { AxiosError, AxiosInstance } from 'axios';

export class TonCenterClient {
  private http: AxiosInstance;
  private readonly maxRetries = 2;

  constructor(opts: { endpoint: string; apiKey: string }) {
    this.http = axios.create({
      baseURL: opts.endpoint,
      headers: { 'X-API-Key': opts.apiKey },
      timeout: 15_000,
    });
  }

  async jsonRpc<T>(method: string, params: Record<string, any>): Promise<T> {
    let attempt = 0;

    while (true) {
      try {
        const { data } = await this.http.post('', {
          jsonrpc: '2.0',
          id: Date.now(),
          method,
          params,
        });

        if (data?.ok === false) {
          throw new Error(`TONCENTER error: ${JSON.stringify(data.error)}`);
        }
        if (data?.error) {
          throw new Error(`TONCENTER rpc error: ${JSON.stringify(data.error)}`);
        }
        return (data.result ?? data) as T;
      } catch (error) {
        const axiosError = error as AxiosError;
        const canRetry = this.shouldRetry(axiosError);
        if (!canRetry || attempt >= this.maxRetries) {
          throw error;
        }

        attempt += 1;
        await this.delay(300 * attempt);
      }
    }
  }

  private shouldRetry(error: AxiosError): boolean {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return true;
    }

    const status = error.response?.status;
    if (status === undefined) {
      return true;
    }
    return status >= 500 || status === 429;
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  getTransactions(
    address: string,
    limit = 10,
    cursor?: { lt: string; hash: string },
  ) {
    const params: Record<string, any> = { address, limit };
    if (cursor?.lt && cursor?.hash) {
      params.lt = cursor.lt;
      params.hash = cursor.hash;
    }
    return this.jsonRpc<any[]>('getTransactions', params);
  }
}
