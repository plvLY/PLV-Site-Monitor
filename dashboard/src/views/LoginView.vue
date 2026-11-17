<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const username = ref('')
const password = ref('')
const passwordVisible = ref(false)
const submitting = ref(false)
const submitError = ref<string | null>(null)

function getRedirectTarget(): string {
  const redirect = route.query.redirect

  if (
    typeof redirect === 'string' &&
    redirect.startsWith('/') &&
    !redirect.startsWith('//') &&
    redirect !== '/login'
  ) {
    return redirect
  }

  return '/overview'
}

async function handleLogin() {
  if (submitting.value) return

  const normalizedUsername = username.value.trim()

  if (!normalizedUsername || !password.value) {
    submitError.value = '请输入用户名和密码。'
    return
  }

  submitting.value = true
  submitError.value = null

  try {
    await auth.login(normalizedUsername, password.value)
    await router.replace(getRedirectTarget())
  } catch {
    submitError.value = auth.error || '登录失败，请检查用户名和密码后重试。'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="login-page">
    <section class="login-panel">
      <div class="login-brand">
        <div class="login-brand-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M4 18V12.5L8 8.5L12 12.5L18.5 6"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              d="M14 6H18.5V10.5"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              d="M4 20H20"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              opacity="0.7"
            />
          </svg>
        </div>

        <div class="login-brand-text">
          <strong>PLV Site Monitor</strong>
          <span>WEBSITE ANALYTICS PLATFORM</span>
        </div>
      </div>

      <div class="login-heading">
        <span class="login-eyebrow">ADMINISTRATION</span>
        <h1>欢迎回来</h1>
        <p>登录管理后台，查看和管理你的网站数据。</p>
      </div>

      <form class="login-form" @submit.prevent="handleLogin">
        <div class="form-field">
          <label for="login-username">管理员账号</label>
          <input
            id="login-username"
            v-model="username"
            type="text"
            name="username"
            placeholder="请输入管理员账号"
            autocomplete="username"
            maxlength="64"
            required
            :disabled="submitting"
          />
        </div>

        <div class="form-field">
          <label for="login-password">登录密码</label>
          <div class="password-input-wrapper">
            <input
              id="login-password"
              v-model="password"
              :type="passwordVisible ? 'text' : 'password'"
              name="password"
              placeholder="请输入登录密码"
              autocomplete="current-password"
              required
              :disabled="submitting"
            />

            <button
              class="password-toggle"
              type="button"
              :aria-label="passwordVisible ? '隐藏密码' : '显示密码'"
              :disabled="submitting"
              @click="passwordVisible = !passwordVisible"
            >
              {{ passwordVisible ? '隐藏' : '显示' }}
            </button>
          </div>
        </div>

        <div
          v-if="submitError"
          class="login-error"
          role="alert"
          aria-live="polite"
        >
          <span class="login-error-icon" aria-hidden="true">!</span>
          <span>{{ submitError }}</span>
        </div>

        <button
          class="login-submit"
          type="submit"
          :disabled="submitting || !username.trim() || !password"
        >
          <span v-if="submitting" class="login-spinner" aria-hidden="true"></span>
          {{ submitting ? '正在登录...' : '登录管理后台' }}
        </button>
      </form>

      <div class="login-footer">
        <span class="login-security-dot"></span>
        <span>安全管理入口 · 仅限授权管理员访问</span>
      </div>
    </section>

    <footer class="login-copyright">
      PLV Site Monitor
    </footer>
  </main>
</template>

<style scoped>
.login-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 40px 20px 24px;
  background:
    radial-gradient(
      circle at 50% 38%,
      rgba(20, 184, 166, 0.07),
      transparent 38%
    ),
    #f6f8fa;
}

.login-panel {
  width: 100%;
  max-width: 420px;
  padding: 40px;
  background: #fff;
  border: 1px solid #e9eef2;
  border-radius: 16px;
  box-shadow:
    0 12px 40px rgba(15, 23, 42, 0.045),
    0 2px 8px rgba(15, 23, 42, 0.025);
}

.login-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 42px;
}

.login-brand-icon {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 43px;
  height: 43px;
  color: #fff;
  background: #14b8a6;
  border-radius: 12px;
}

.login-brand-icon svg {
  width: 25px;
  height: 25px;
}

.login-brand-text {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.login-brand-text strong {
  color: #1f2937;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.1px;
}

.login-brand-text span {
  color: #94a3b8;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 1.1px;
}

.login-heading {
  margin-bottom: 30px;
}

.login-eyebrow {
  color: #0f9488;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.3px;
}

.login-heading h1 {
  margin: 12px 0 9px;
  color: #1f2937;
  font-size: 27px;
  font-weight: 700;
  letter-spacing: -0.7px;
}

.login-heading p {
  margin: 0;
  color: #8491a3;
  font-size: 12px;
  line-height: 1.7;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 21px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.form-field label {
  color: #475569;
  font-size: 12px;
  font-weight: 600;
}

.form-field input {
  width: 100%;
  height: 44px;
  padding: 0 13px;
  color: #334155;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  outline: none;
  font: inherit;
  font-size: 12px;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.form-field input::placeholder {
  color: #b0bac7;
}

.form-field input:focus {
  border-color: #7bcfc0;
  box-shadow: 0 0 0 3px rgba(15, 148, 136, 0.09);
}

.form-field input:disabled {
  background: #f8fafc;
  cursor: not-allowed;
}

.password-input-wrapper {
  position: relative;
}

.password-input-wrapper input {
  padding-right: 65px;
}

.password-toggle {
  position: absolute;
  top: 50%;
  right: 12px;
  padding: 5px;
  color: #0f9488;
  background: transparent;
  border: 0;
  font-size: 11px;
  transform: translateY(-50%);
}

.password-toggle:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.login-error {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 11px 12px;
  color: #b45309;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  font-size: 11px;
  line-height: 1.6;
}

.login-error-icon {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 16px;
  height: 16px;
  margin-top: 1px;
  color: #fff;
  background: #d97706;
  border-radius: 50%;
  font-size: 10px;
  font-weight: 700;
}

.login-submit {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  width: 100%;
  height: 45px;
  margin-top: 3px;
  color: #fff;
  background: #0f9488;
  border: 0;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  transition: background 0.2s, box-shadow 0.2s;
}

.login-submit:hover:not(:disabled) {
  background: #0f766e;
  box-shadow: 0 4px 12px rgba(15, 148, 136, 0.18);
}

.login-submit:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.login-spinner {
  width: 15px;
  height: 15px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: login-spin 0.7s linear infinite;
}

@keyframes login-spin {
  to {
    transform: rotate(360deg);
  }
}

.login-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin-top: 27px;
  padding-top: 19px;
  color: #94a3b8;
  border-top: 1px solid #f0f3f6;
  font-size: 10px;
}

.login-security-dot {
  width: 6px;
  height: 6px;
  background: #22c58b;
  border-radius: 50%;
}

.login-copyright {
  margin-top: 24px;
  color: #a0aab8;
  font-size: 10px;
  letter-spacing: 0.3px;
}

@media (max-width: 480px) {
  .login-page {
    justify-content: center;
    padding: 24px 16px;
  }

  .login-panel {
    padding: 30px 24px;
    border-radius: 13px;
  }

  .login-brand {
    margin-bottom: 34px;
  }

  .login-heading h1 {
    font-size: 25px;
  }
}
</style>