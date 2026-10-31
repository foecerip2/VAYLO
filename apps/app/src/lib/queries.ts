import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActiveCampaignDTO, AttentionDTO, MyRefTreeDTO, SupportMessageDTO, SupportTicketDTO, DevicesDTO, WheelDTO, AddonCatalogDTO, AchievementDTO, AppConfigDTO, MeDTO, QuestDTO, NodeDTO, PaymentDTO, PaymentMethodDTO, PlanDTO, ReferralStatsDTO, SubscriptionDTO } from '@vpn/shared';
import { get, post } from './api';

export type PublicConfig = AppConfigDTO;

export const useConfig = () => useQuery({ queryKey: ['config'], queryFn: () => get<PublicConfig>('/config'), staleTime: 30_000, refetchOnWindowFocus: true, refetchInterval: 60_000, refetchIntervalInBackground: false });
/** Красный индикатор для администратора: опрос только если пользователь привязан к админу */
export const useAdminAttention = () => {
  const me = useMe();
  return useQuery({ queryKey: ['admin-attention'], queryFn: () => get<AttentionDTO>('/admin-attention'), enabled: Boolean(me.data?.adminRole), refetchInterval: 30_000, refetchOnWindowFocus: true, staleTime: 10_000 });
};
export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => get<MeDTO>('/me'), staleTime: 15_000 });
export const useSubscription = () => useQuery({ queryKey: ['subscription'], queryFn: () => get<SubscriptionDTO>('/subscription'), staleTime: 15_000 });
export const usePlans = () => useQuery({ queryKey: ['plans'], queryFn: () => get<PlanDTO[]>('/plans'), staleTime: 60_000 });
export const useNodes = () => useQuery({ queryKey: ['nodes'], queryFn: () => get<NodeDTO[]>('/nodes'), staleTime: 30_000 });
export const useCampaigns = () => useQuery({ queryKey: ['campaigns'], queryFn: () => get<ActiveCampaignDTO[]>('/campaigns'), staleTime: 60_000 });
export const useMethods = () => useQuery({ queryKey: ['methods'], queryFn: () => get<PaymentMethodDTO[]>('/payment-methods'), staleTime: 60_000 });
export const usePayments = () => useQuery({ queryKey: ['payments'], queryFn: () => get<PaymentDTO[]>('/payments') });
export const useReferrals = () => useQuery({ queryKey: ['referrals'], queryFn: () => get<ReferralStatsDTO>('/referrals'), staleTime: 60_000 });

export const useAddons = () => useQuery({ queryKey: ['addons'], queryFn: () => get<AddonCatalogDTO>('/addons'), staleTime: 15_000 });
export const useQuests = () => useQuery({ queryKey: ['quests'], queryFn: () => get<{ enabled: boolean; streak: number; quests: QuestDTO[]; achievements: AchievementDTO[]; newAchievements?: { code: string; title: string; icon: string; days: number }[] }>('/quests'), staleTime: 10_000 });
export const useWheel = (enabled = true) => useQuery({ queryKey: ['wheel'], queryFn: () => get<WheelDTO>('/wheel'), staleTime: 0, refetchOnMount: 'always', enabled });
export interface TxDTO { id: string; type: string; amount: number; balanceAfter: number; note: string | null; createdAt: string }
export const useTransactions = () => useQuery({ queryKey: ['transactions'], queryFn: () => get<TxDTO[]>('/transactions'), staleTime: 15_000 });

export function useStartTrial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post<unknown>('/subscription/trial'),
    // ответ — не полный MeDTO (нет gate/adminRole и т.п.), поэтому перечитываем профиль целиком
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: ['subscription'] });
    },
  });
}

export function useRefreshAfterPayment() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['me'] });
    void qc.invalidateQueries({ queryKey: ['subscription'] });
    void qc.invalidateQueries({ queryKey: ['payments'] });
    void qc.invalidateQueries({ queryKey: ['gifts'] });
    void qc.invalidateQueries({ queryKey: ['addons'] });
    void qc.invalidateQueries({ queryKey: ['transactions'] });
    void qc.invalidateQueries({ queryKey: ['quests'] });
    void qc.invalidateQueries({ queryKey: ['referrals'] });
    void qc.invalidateQueries({ queryKey: ['wheel'] });
  };
}

/** Публичный список тарифов для лендинга (без авторизации) */
export const usePlansPublic = () => useQuery({ queryKey: ['plans-public'], queryFn: () => get<PlanDTO[]>('/plans'), staleTime: 60_000 });

export const useDevices = (enabled = true) => useQuery({ queryKey: ['devices'], queryFn: () => get<DevicesDTO>('/devices'), staleTime: 10_000, enabled });

export interface SupportOverview { enabled: boolean; ai: boolean; mutedUntil: string | null; tickets: SupportTicketDTO[] }
export interface SupportThread { ticket: SupportTicketDTO & { aiActive: boolean }; messages: SupportMessageDTO[]; mutedUntil: string | null }
export const useSupport = () => useQuery({ queryKey: ['support'], queryFn: () => get<SupportOverview>('/support'), staleTime: 0, refetchOnMount: 'always', refetchInterval: 20_000 });
export const useSupportThread = (id: string) => useQuery({ queryKey: ['support', id], queryFn: () => get<SupportThread>(`/support/tickets/${id}`), refetchInterval: 6_000, refetchIntervalInBackground: false });

export const useRefTree = () => useQuery({ queryKey: ['referrals', 'tree'], queryFn: () => get<MyRefTreeDTO>('/referrals/tree'), staleTime: 15_000 });
