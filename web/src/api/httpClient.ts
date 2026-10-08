import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../store/authStore';

// The API is served by this same Next.js app (app/api/[...path]), so it is always same-origin.
const baseURL = '/api';

export const httpClient = axios.create({
  baseURL,
  withCredentials: true, // sends the httpOnly refresh cookie
});

httpClient.interceptors.request.use((config) => {
  const { accessToken } = useAuthStore.getState();
  if (accessToken) {
    config.headers.set('Authorization', `Bearer ${accessToken}`);
  }
  return config;
});

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = axios
      .post(
        `${baseURL}/auth/refresh`,
        {},
        { withCredentials: true },
      )
      .then((res) => res.data.accessToken as string)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

httpClient.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const config = error.config as RetriableConfig | undefined;
    // A 401 from these is the answer itself (wrong password, wrong code, expired login), not an
    // expired access token — refreshing and retrying would only repeat the failed attempt.
    const isAuthEndpoint = ['/auth/login', '/auth/refresh', '/auth/mfa/'].some((path) => config?.url?.includes(path));

    if (error.response?.status === 401 && config && !config._retried && !isAuthEndpoint) {
      config._retried = true;
      try {
        const newAccessToken = await refreshAccessToken();
        useAuthStore.getState().setAccessToken(newAccessToken);
        config.headers.set('Authorization', `Bearer ${newAccessToken}`);
        return httpClient.request(config);
      } catch (refreshErr) {
        useAuthStore.getState().clearSession();
        return Promise.reject(refreshErr);
      }
    }

    return Promise.reject(error);
  },
);
