import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { apiClient } from '../services/api/client'
import { ApiError } from '../types/api'

export interface Admin {
  id: number
  username: string
}

export type AuthStatus =
  | 'unknown'
  | 'authenticated'
  | 'unauthenticated'
  | 'error'

interface AuthResponse {
  authenticated: true
  admin: Admin
}

interface LoginRequest {
  username: string
  password: string
}

interface LoginResponse extends AuthResponse {}

interface LogoutResponse {
  loggedOut: true
}

type EmptyMeta = Record<string, never>

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Authentication request failed.'
}

export const useAuthStore = defineStore('auth', () => {
  const admin = ref<Admin | null>(null)
  const status = ref<AuthStatus>('unknown')
  const loading = ref(false)
  const error = ref<string | null>(null)

  const authenticated = computed(
    () => status.value === 'authenticated',
  )

  let initializationPromise: Promise<void> | null = null

  function clearAuth() {
    admin.value = null
    status.value = 'unauthenticated'
  }

  async function initialize(): Promise<void> {
    if (
      status.value === 'authenticated' ||
      status.value === 'unauthenticated'
    ) {
      return
    }

    if (initializationPromise) {
      return initializationPromise
    }

    initializationPromise = (async () => {
      loading.value = true
      error.value = null

      try {
        const response = await apiClient.get<
          AuthResponse,
          EmptyMeta
        >('/api/auth/me')

        if (
          response.data.authenticated !== true ||
          !response.data.admin
        ) {
          throw new Error('Invalid authentication response.')
        }

        admin.value = response.data.admin
        status.value = 'authenticated'
      } catch (requestError) {
        if (
          requestError instanceof ApiError &&
          requestError.code === 'UNAUTHORIZED'
        ) {
          clearAuth()
          return
        }

        status.value = 'error'
        error.value = getErrorMessage(requestError)

        throw requestError
      } finally {
        loading.value = false
        initializationPromise = null
      }
    })()

    return initializationPromise
  }

  async function login(
    username: string,
    password: string,
  ): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const response = await apiClient.post<
        LoginResponse,
        EmptyMeta,
        LoginRequest
      >(
        '/api/auth/login',
        {
          username,
          password,
        },
      )

      if (
        response.data.authenticated !== true ||
        !response.data.admin
      ) {
        throw new Error('Invalid login response.')
      }

      admin.value = response.data.admin
      status.value = 'authenticated'
    } catch (requestError) {
      error.value = getErrorMessage(requestError)
      throw requestError
    } finally {
      loading.value = false
    }
  }

  async function logout(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      await apiClient.post<
        LogoutResponse,
        EmptyMeta,
        Record<string, never>
      >(
        '/api/auth/logout',
        {},
      )

      clearAuth()
    } catch (requestError) {
      clearAuth()
      error.value = getErrorMessage(requestError)

      throw requestError
    } finally {
      loading.value = false
    }
  }

  return {
    admin,
    status,
    loading,
    error,
    authenticated,
    initialize,
    login,
    logout,
    clearAuth,
  }
})