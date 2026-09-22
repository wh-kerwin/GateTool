<template>
  <a-layout class="layout">
    <a-layout-header class="header">
      <div class="logo">Gate Prediction Tracker</div>
      <div class="header-right">
        <a-tag :color="wsConnected ? 'green' : 'orange'">
          {{ wsConnected ? '行情已连接' : '行情未连接' }}
        </a-tag>
        <a-tag color="arcoblue">{{ marketLabel }}</a-tag>
        <span class="disclaimer">仅用于记录与验证个人判断，不构成投资建议</span>
      </div>
    </a-layout-header>

    <a-layout>
      <a-layout-sider :width="180" collapsible>
        <a-menu :default-selected-keys="[route.name as string]" @menu-item-click="go">
          <a-menu-item key="dashboard">总览</a-menu-item>
          <a-menu-item key="create">创建预测</a-menu-item>
          <a-menu-item key="pending">待验证</a-menu-item>
          <a-menu-item key="history">预测历史</a-menu-item>
          <a-menu-item key="statistics">统计分析</a-menu-item>
          <a-menu-item key="advisor">智能交易辅助</a-menu-item>
        </a-menu>
      </a-layout-sider>

      <a-layout-content class="content">
        <router-view />
      </a-layout-content>
    </a-layout>
  </a-layout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAppStore } from './stores/app';

const store = useAppStore();
const route = useRoute();
const router = useRouter();

const wsConnected = computed(() => store.wsConnected);
const marketLabel = computed(() => (store.config?.market === 'spot' ? 'Gate 现货' : 'Gate USDT 永续'));

const go = (key: string) => router.push({ name: key });

let timer: number | undefined;

onMounted(async () => {
  await store.loadConfig();
  await store.loadTickers();
  store.connect();
  timer = window.setInterval(() => store.loadTickers(), 15000);
});

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer);
});
</script>

<style scoped>
.layout {
  min-height: 100vh;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #1d2129;
  padding: 0 20px;
}

.logo {
  color: #fff;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.disclaimer {
  color: #a9aeb8;
  font-size: 12px;
}

.content {
  padding: 0;
}
</style>
