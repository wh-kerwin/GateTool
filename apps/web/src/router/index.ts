import { createRouter, createWebHistory } from 'vue-router';

const routes = [
  { path: '/', name: 'dashboard', component: () => import('../views/DashboardView.vue'), meta: { title: '总览' } },
  { path: '/create', name: 'create', component: () => import('../views/CreateView.vue'), meta: { title: '创建预测' } },
  { path: '/pending', name: 'pending', component: () => import('../views/PendingView.vue'), meta: { title: '待验证' } },
  { path: '/history', name: 'history', component: () => import('../views/HistoryView.vue'), meta: { title: '预测历史' } },
  { path: '/statistics', name: 'statistics', component: () => import('../views/StatisticsView.vue'), meta: { title: '统计分析' } },
  { path: '/advisor', name: 'advisor', component: () => import('../views/AdvisorView.vue'), meta: { title: '智能交易辅助' } },
  { path: '/signals/:id', name: 'signal-detail', component: () => import('../views/SignalDetailView.vue'), meta: { title: '推荐详情' } },
  { path: '/predictions/:id', name: 'detail', component: () => import('../views/DetailView.vue'), meta: { title: '预测详情' } },
];

export default createRouter({
  history: createWebHistory(),
  routes,
});
