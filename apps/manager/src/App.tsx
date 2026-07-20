import {
  ActionIcon,
  Alert,
  Anchor,
  AppShell,
  Badge,
  Box,
  Button,
  Code,
  Container,
  Divider,
  Group,
  Loader,
  MantineProvider,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
  createTheme
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  AlertCircle,
  Bot,
  BotOff,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  ExternalLink,
  Inbox,
  LogIn,
  LogOut,
  MessageCircle,
  RefreshCcw,
  UserRound
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { AuthRequiredError, managerApi } from "./api";
import {
  LEAD_STATUS_OPTIONS,
  aiReviewLabel,
  contactLabel,
  conversationChannelLabel,
  conversationMessageBody,
  conversationMessageSenderLabel,
  deliveryStatusColor,
  deliveryStatusLabel,
  deliveryTooltip,
  displayContactName,
  errorMessage,
  formatDate,
  formatLeadCount,
  formatMessageCount,
  formKindLabel,
  roleLabel,
  sourceChannelLabel,
  statusBadgeColor,
  statusLabel,
  structuredIntakeSlotLabel,
  structuredIntakeSourceLabel,
  timelineEventLabel,
  timelineIconColor,
  timelineSummaryLabel
} from "./display";
import {
  AI_REVIEW_LABELS,
  isLeadStatus,
  type AiReviewLabel,
  type LeadStatus,
  type ManagerAiControl,
  type ManagerLeadDetail,
  type ManagerLeadListItem,
  type ManagerTelegramBindingStatus,
  type ManagerUser
} from "./types";

type SessionState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "error"; message: string }
  | {
      status: "signed-in";
      user: ManagerUser;
      telegramBinding: ManagerTelegramBindingStatus;
    };

type LeadsState =
  | { status: "idle" | "loading"; leads: ManagerLeadListItem[] }
  | { status: "error"; leads: ManagerLeadListItem[]; message: string };

type DetailState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; lead: ManagerLeadDetail }
  | { status: "error"; message: string };

type StatusChangeState =
  | { status: "idle" }
  | { status: "saving"; nextStatus: LeadStatus }
  | { status: "error"; message: string };

type TakeoverState =
  | { status: "idle" }
  | { status: "saving"; publicConversationId: string }
  | { status: "error"; publicConversationId: string; message: string };

type AiControlState =
  | { status: "loading" }
  | { status: "loaded"; control: ManagerAiControl }
  | { status: "saving"; control: ManagerAiControl }
  | { status: "error"; message: string; control?: ManagerAiControl };

type TelegramBindTokenState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; token: string; expiresAt: string }
  | { status: "error"; message: string };

const theme = createTheme({
  primaryColor: "green",
  defaultRadius: "sm",
  fontFamily:
    'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  headings: {
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  }
});

const COLLAPSED_DIALOG_MESSAGE_LIMIT = 4;

export function App() {
  return (
    <MantineProvider theme={theme}>
      <ManagerApp />
    </MantineProvider>
  );
}

function ManagerApp() {
  const [session, setSession] = useState<SessionState>({ status: "loading" });

  const loadSession = useCallback(async () => {
    setSession({ status: "loading" });

    try {
      const response = await managerApi.me();
      setSession({
        status: "signed-in",
        user: response.user,
        telegramBinding: response.telegramBinding
      });
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        setSession({ status: "signed-out" });
        return;
      }

      setSession({ status: "error", message: errorMessage(error) });
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  if (session.status === "loading") {
    return <FullPageLoading />;
  }

  if (session.status === "signed-out") {
    return <LoginScreen />;
  }

  if (session.status === "error") {
    return <LoginScreen error={session.message} onRetry={loadSession} />;
  }

  return (
    <ManagerWorkspace
      user={session.user}
      telegramBinding={session.telegramBinding}
      onSignedOut={() => setSession({ status: "signed-out" })}
    />
  );
}

function LoginScreen({ error, onRetry }: { error?: string; onRetry?: () => void }) {
  return (
    <Box className="loginScreen">
      <Paper className="loginPanel" withBorder shadow="xs">
        <Stack gap="lg">
          <Group gap="sm">
            <ThemeIcon size={38} radius="sm" variant="light" color="green">
              <UserRound size={20} />
            </ThemeIcon>
            <Box>
              <Text size="xs" c="dimmed" fw={700} tt="uppercase">
                Granit AI
              </Text>
              <Title order={1} size="h2">
                Операционная панель
              </Title>
            </Box>
          </Group>

          {error ? (
            <Alert color="red" variant="light" icon={<AlertCircle size={18} />}>
              {error}
            </Alert>
          ) : null}

          <Group gap="sm">
            <Button
              component="a"
              href="/auth/yandex/start?return_to=/manager"
              leftSection={<LogIn size={17} />}
            >
              Войти через Яндекс
            </Button>
            {onRetry ? (
              <Button variant="default" onClick={onRetry} leftSection={<RefreshCcw size={16} />}>
                Повторить
              </Button>
            ) : null}
          </Group>
        </Stack>
      </Paper>
    </Box>
  );
}

function TelegramBindingControl({
  binding,
  tokenState,
  onCreateToken,
  disabled
}: {
  binding: ManagerTelegramBindingStatus;
  tokenState: TelegramBindTokenState;
  onCreateToken: () => void;
  disabled: boolean;
}) {
  if (binding.bound) {
    return (
      <Box className="telegramBinding" visibleFrom="md">
        <Text size="xs" c="dimmed" fw={700} tt="uppercase">
          Telegram
        </Text>
        <Text size="sm" fw={600} truncate="end">
          {binding.username ? `@${binding.username}` : binding.displayName ?? "Привязан"}
        </Text>
      </Box>
    );
  }

  return (
    <Box className="telegramBinding" visibleFrom="lg">
      <Group gap="xs" wrap="nowrap">
        <Button
          size="xs"
          variant="default"
          leftSection={<MessageCircle size={14} />}
          loading={tokenState.status === "loading"}
          disabled={disabled}
          onClick={onCreateToken}
        >
          Telegram
        </Button>
        {tokenState.status === "loaded" ? (
          <Tooltip label={`Действует до ${formatDate(tokenState.expiresAt)}`}>
            <Code className="telegramBindCode">/start {tokenState.token}</Code>
          </Tooltip>
        ) : null}
      </Group>
      {tokenState.status === "error" ? (
        <Text size="xs" c="red">
          {tokenState.message}
        </Text>
      ) : null}
    </Box>
  );
}

function AiGlobalControl({
  state,
  disabled,
  onToggle
}: {
  state: AiControlState;
  disabled: boolean;
  onToggle: () => void;
}) {
  const control =
    state.status === "loaded" || state.status === "saving"
      ? state.control
      : state.status === "error"
      ? state.control
      : undefined;
  const enabled = control?.enabled ?? true;
  const label = enabled ? "AI включен" : "AI остановлен";

  return (
    <Box className="aiGlobalControl" visibleFrom="md">
      <Group gap="xs" wrap="nowrap">
        <Button
          size="xs"
          variant={enabled ? "light" : "filled"}
          color={enabled ? "green" : "red"}
          leftSection={enabled ? <Bot size={14} /> : <BotOff size={14} />}
          loading={state.status === "loading" || state.status === "saving"}
          disabled={disabled || !control}
          onClick={onToggle}
        >
          {label}
        </Button>
        {control ? (
          <Text size="xs" c="dimmed" visibleFrom="lg">
            v{control.version}
          </Text>
        ) : null}
      </Group>
      {state.status === "error" ? (
        <Text size="xs" c="red">
          {state.message}
        </Text>
      ) : null}
    </Box>
  );
}

function ManagerWorkspace({
  user,
  telegramBinding,
  onSignedOut
}: {
  user: ManagerUser;
  telegramBinding: ManagerTelegramBindingStatus;
  onSignedOut: () => void;
}) {
  const [opened, { toggle, close }] = useDisclosure();
  const [leadsState, setLeadsState] = useState<LeadsState>({
    status: "idle",
    leads: []
  });
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [detailState, setDetailState] = useState<DetailState>({ status: "idle" });
  const [statusChangeState, setStatusChangeState] = useState<StatusChangeState>({ status: "idle" });
  const [takeoverState, setTakeoverState] = useState<TakeoverState>({ status: "idle" });
  const [aiControlState, setAiControlState] = useState<AiControlState>({ status: "loading" });
  const [telegramBindTokenState, setTelegramBindTokenState] = useState<TelegramBindTokenState>({
    status: "idle"
  });
  const leads = leadsState.leads;
  const selectedLead = useMemo(
    () => leads.find((lead) => lead.leadId === selectedLeadId) ?? null,
    [leads, selectedLeadId]
  );

  const loadLeads = useCallback(async () => {
    setLeadsState((current) => ({ status: "loading", leads: current.leads }));

    try {
      const response = await managerApi.listLeads();
      setLeadsState({ status: "idle", leads: response.leads });
      setSelectedLeadId((current) => {
        if (current && response.leads.some((lead) => lead.leadId === current)) {
          return current;
        }

        return response.leads[0]?.leadId ?? null;
      });
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        onSignedOut();
        return;
      }

      setLeadsState((current) => ({
        status: "error",
        leads: current.leads,
        message: errorMessage(error)
      }));
    }
  }, [onSignedOut]);

  useEffect(() => {
    void loadLeads();

    const intervalId = window.setInterval(() => {
      void loadLeads();
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, [loadLeads]);

  const loadAiControl = useCallback(async () => {
    try {
      const response = await managerApi.getAiControl();
      setAiControlState({ status: "loaded", control: response.control });
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        onSignedOut();
        return;
      }

      setAiControlState({ status: "error", message: errorMessage(error) });
    }
  }, [onSignedOut]);

  useEffect(() => {
    void loadAiControl();
  }, [loadAiControl]);

  useEffect(() => {
    setStatusChangeState({ status: "idle" });
    setTakeoverState({ status: "idle" });

    if (!selectedLeadId) {
      setDetailState({ status: "idle" });
      return;
    }

    let cancelled = false;
    setDetailState({ status: "loading" });

    managerApi
      .getLead(selectedLeadId)
      .then((response) => {
        if (!cancelled) {
          setDetailState({ status: "loaded", lead: response.lead });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        if (error instanceof AuthRequiredError) {
          onSignedOut();
          return;
        }

        setDetailState({ status: "error", message: errorMessage(error) });
      });

    return () => {
      cancelled = true;
    };
  }, [onSignedOut, selectedLeadId, selectedLead?.updatedAt]);

  const handleStatusChange = useCallback(
    async (status: LeadStatus) => {
      if (!selectedLeadId) {
        return;
      }

      setStatusChangeState({ status: "saving", nextStatus: status });

      try {
        const response = await managerApi.changeLeadStatus(selectedLeadId, status);

        setDetailState({ status: "loaded", lead: response.lead });
        setLeadsState((current) => ({
          ...current,
          leads: replaceLeadListItem(current.leads, response.lead)
        }));
        setStatusChangeState({ status: "idle" });
      } catch (error) {
        if (error instanceof AuthRequiredError) {
          onSignedOut();
          return;
        }

        setStatusChangeState({ status: "error", message: errorMessage(error) });
      }
    },
    [onSignedOut, selectedLeadId]
  );

  const handleTakeover = useCallback(
    async (publicConversationId: string) => {
      if (!selectedLeadId) {
        return;
      }

      setTakeoverState({ status: "saving", publicConversationId });

      try {
        const response = await managerApi.takeoverConversation(
          selectedLeadId,
          publicConversationId
        );

        setDetailState({ status: "loaded", lead: response.lead });
        setLeadsState((current) => ({
          ...current,
          leads: replaceLeadListItem(current.leads, response.lead)
        }));
        setTakeoverState({ status: "idle" });
      } catch (error) {
        if (error instanceof AuthRequiredError) {
          onSignedOut();
          return;
        }

        setTakeoverState({
          status: "error",
          publicConversationId,
          message: errorMessage(error)
        });
      }
    },
    [onSignedOut, selectedLeadId]
  );

  const handleSetConversationAiControl = useCallback(
    async (publicConversationId: string, enabled: boolean) => {
      if (!selectedLeadId) {
        return;
      }

      setTakeoverState({ status: "saving", publicConversationId });

      try {
        const response = await managerApi.setConversationAiControl(
          selectedLeadId,
          publicConversationId,
          enabled
        );

        setDetailState({ status: "loaded", lead: response.lead });
        setLeadsState((current) => ({
          ...current,
          leads: replaceLeadListItem(current.leads, response.lead)
        }));
        setTakeoverState({ status: "idle" });
      } catch (error) {
        if (error instanceof AuthRequiredError) {
          onSignedOut();
          return;
        }

        setTakeoverState({
          status: "error",
          publicConversationId,
          message: errorMessage(error)
        });
      }
    },
    [onSignedOut, selectedLeadId]
  );

  const handleSetGlobalAiControl = useCallback(async () => {
    const current =
      aiControlState.status === "loaded" || aiControlState.status === "saving"
        ? aiControlState.control
        : aiControlState.status === "error"
        ? aiControlState.control
        : undefined;

    if (!current) {
      return;
    }

    setAiControlState({ status: "saving", control: current });

    try {
      const response = await managerApi.setAiControl(!current.enabled, current.version);
      setAiControlState({ status: "loaded", control: response.control });
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        onSignedOut();
        return;
      }

      setAiControlState({
        status: "error",
        message: errorMessage(error),
        control: current
      });
      void loadAiControl();
    }
  }, [aiControlState, loadAiControl, onSignedOut]);

  const handleLogout = async () => {
    try {
      await managerApi.logout();
    } finally {
      onSignedOut();
    }
  };

  const handleCreateTelegramBindToken = async () => {
    setTelegramBindTokenState({ status: "loading" });

    try {
      const response = await managerApi.createTelegramBindToken();
      setTelegramBindTokenState({
        status: "loaded",
        token: response.bindToken.token,
        expiresAt: response.bindToken.expiresAt
      });
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        onSignedOut();
        return;
      }

      setTelegramBindTokenState({ status: "error", message: errorMessage(error) });
    }
  };

  return (
    <AppShell
      header={{ height: 64 }}
      navbar={{
        width: 360,
        breakpoint: "md",
        collapsed: { mobile: !opened, desktop: false }
      }}
      padding={0}
      className="managerShell"
    >
      <AppShell.Header>
        <Group className="topbar" justify="space-between" wrap="nowrap">
          <Group gap="md" wrap="nowrap">
            <ActionIcon
              variant="subtle"
              color="gray"
              hiddenFrom="md"
              onClick={toggle}
              aria-label="Открыть список заявок"
            >
              <Inbox size={20} />
            </ActionIcon>
            <Box>
              <Text size="xs" c="dimmed" fw={700} tt="uppercase">
                Granit AI
              </Text>
              <Title order={1} size="h3">
                Заявки
              </Title>
            </Box>
          </Group>

          <Group gap="sm" wrap="nowrap">
            <AiGlobalControl
              state={aiControlState}
              disabled={user.role === "viewer"}
              onToggle={handleSetGlobalAiControl}
            />
            <TelegramBindingControl
              binding={telegramBinding}
              tokenState={telegramBindTokenState}
              onCreateToken={handleCreateTelegramBindToken}
              disabled={user.role === "viewer"}
            />
            <Box className="userBadge" visibleFrom="sm">
              <Text size="sm" fw={600} truncate="end">
                {user.email}
              </Text>
              <Text size="xs" c="dimmed">
                {roleLabel(user.role)}
              </Text>
            </Box>
            <Tooltip label="Выйти">
              <ActionIcon variant="default" onClick={handleLogout} aria-label="Выйти">
                <LogOut size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p={0}>
        <Stack gap={0} className="navbarContent">
          <Group className="paneHeader" justify="space-between" wrap="nowrap">
            <Box>
              <Text fw={700}>Входящие</Text>
              <Text size="xs" c="dimmed">
                {leads.length ? formatLeadCount(leads.length) : "Нет новых"}
              </Text>
            </Box>
            <Tooltip label="Обновить">
              <ActionIcon
                variant="subtle"
                color="gray"
                onClick={loadLeads}
                loading={leadsState.status === "loading"}
                aria-label="Обновить заявки"
              >
                <RefreshCcw size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>

          <Divider />

          {leadsState.status === "error" ? (
            <Alert m="md" color="red" variant="light" icon={<AlertCircle size={18} />}>
              {leadsState.message}
            </Alert>
          ) : null}

          <LeadInbox
            leads={leads}
            loading={leadsState.status === "loading" && leads.length === 0}
            selectedLeadId={selectedLeadId}
            onSelect={(leadId) => {
              setSelectedLeadId(leadId);
              close();
            }}
          />
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main>
        <Container fluid className="mainArea">
          <LeadDetailPanel
            selectedLead={selectedLead}
            detailState={detailState}
            statusChangeState={statusChangeState}
            onStatusChange={handleStatusChange}
            takeoverState={takeoverState}
            canManageAi={user.role !== "viewer"}
            onTakeover={handleTakeover}
            onSetConversationAiControl={handleSetConversationAiControl}
          />
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}

function LeadInbox({
  leads,
  loading,
  selectedLeadId,
  onSelect
}: {
  leads: ManagerLeadListItem[];
  loading: boolean;
  selectedLeadId: string | null;
  onSelect: (leadId: string) => void;
}) {
  if (loading) {
    return (
      <Stack gap="xs" p="md">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} height={72} radius="sm" />
        ))}
      </Stack>
    );
  }

  if (!leads.length) {
    return (
      <Stack className="emptyState" align="center" gap="sm">
        <ThemeIcon variant="light" color="gray" size={42} radius="sm">
          <Inbox size={21} />
        </ThemeIcon>
        <Text fw={600}>Заявок нет</Text>
      </Stack>
    );
  }

  return (
    <ScrollArea className="inboxScroll">
      <Table verticalSpacing="sm" horizontalSpacing="md" className="leadTable">
        <Table.Tbody>
          {leads.map((lead) => (
            <Table.Tr
              key={lead.leadId}
              className="leadRow"
              data-selected={lead.leadId === selectedLeadId || undefined}
              tabIndex={0}
              onClick={() => onSelect(lead.leadId)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(lead.leadId);
                }
              }}
            >
              <Table.Td>
                <Stack gap={5}>
                  <Group justify="space-between" gap="xs" wrap="nowrap">
                    <Text fw={700} size="sm" truncate="end">
                      {displayContactName(lead)}
                    </Text>
                    <Badge size="xs" color={statusBadgeColor(lead.status)} variant="light">
                      {statusLabel(lead.status)}
                    </Badge>
                  </Group>
                  <Text size="sm" c="dimmed" truncate="end">
                    {lead.contact.phone ?? lead.contact.email ?? "Контакт не указан"}
                  </Text>
                  <Group gap={6} wrap="nowrap">
                    <Badge size="xs" color="blue" variant="light">
                      {sourceChannelLabel(lead.source.channel)}
                    </Badge>
                    <Text size="xs" c="dimmed" truncate="end">
                      Активность {formatDate(lead.updatedAt)}
                    </Text>
                  </Group>
                </Stack>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}

function LeadDetailPanel({
  selectedLead,
  detailState,
  statusChangeState,
  onStatusChange,
  takeoverState,
  canManageAi,
  onTakeover,
  onSetConversationAiControl
}: {
  selectedLead: ManagerLeadListItem | null;
  detailState: DetailState;
  statusChangeState: StatusChangeState;
  onStatusChange: (status: LeadStatus) => void;
  takeoverState: TakeoverState;
  canManageAi: boolean;
  onTakeover: (publicConversationId: string) => void;
  onSetConversationAiControl: (publicConversationId: string, enabled: boolean) => void;
}) {
  if (!selectedLead) {
    return (
      <Paper className="detailPanel" withBorder>
        <Stack className="emptyState" align="center" gap="sm">
          <ThemeIcon variant="light" color="gray" size={46} radius="sm">
            <Inbox size={23} />
          </ThemeIcon>
          <Text fw={700}>Выберите заявку</Text>
        </Stack>
      </Paper>
    );
  }

  if (
    detailState.status === "loading" ||
    detailState.status === "idle" ||
    (detailState.status === "loaded" && detailState.lead.leadId !== selectedLead.leadId)
  ) {
    return (
      <Paper className="detailPanel" withBorder>
        <Stack gap="md">
          <Skeleton height={32} width="42%" radius="sm" />
          <Skeleton height={18} width="28%" radius="sm" />
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <Skeleton height={76} radius="sm" />
            <Skeleton height={76} radius="sm" />
            <Skeleton height={76} radius="sm" />
            <Skeleton height={76} radius="sm" />
          </SimpleGrid>
          <Skeleton height={130} radius="sm" />
        </Stack>
      </Paper>
    );
  }

  if (detailState.status === "error") {
    return (
      <Paper className="detailPanel" withBorder>
        <Alert color="red" variant="light" icon={<AlertCircle size={18} />}>
          {detailState.message}
        </Alert>
      </Paper>
    );
  }

  return (
    <LoadedLeadDetail
      lead={detailState.lead}
      statusChangeState={statusChangeState}
      onStatusChange={onStatusChange}
      takeoverState={takeoverState}
      canManageAi={canManageAi}
      onTakeover={onTakeover}
      onSetConversationAiControl={onSetConversationAiControl}
    />
  );
}

function LoadedLeadDetail({
  lead,
  statusChangeState,
  onStatusChange,
  takeoverState,
  canManageAi,
  onTakeover,
  onSetConversationAiControl
}: {
  lead: ManagerLeadDetail;
  statusChangeState: StatusChangeState;
  onStatusChange: (status: LeadStatus) => void;
  takeoverState: TakeoverState;
  canManageAi: boolean;
  onTakeover: (publicConversationId: string) => void;
  onSetConversationAiControl: (publicConversationId: string, enabled: boolean) => void;
}) {
  const [selectedStatus, setSelectedStatus] = useState<LeadStatus>(lead.status);
  const utmEntries = Object.entries(lead.source.utm ?? {}).filter(([, value]) => Boolean(value));
  const isSaving = statusChangeState.status === "saving";

  useEffect(() => {
    setSelectedStatus(lead.status);
  }, [lead.leadId, lead.status]);

  return (
    <Paper className="detailPanel" withBorder>
      <Stack gap="xl">
        <Group justify="space-between" gap="md" align="flex-start">
          <Box className="detailTitle">
            <Group gap="xs" mb={8}>
              <Badge color={statusBadgeColor(lead.status)} variant="light">
                {statusLabel(lead.status)}
              </Badge>
              <Badge color="blue" variant="light">
                {sourceChannelLabel(lead.source.channel)}
              </Badge>
            </Group>
            <Title order={2}>{displayContactName(lead)}</Title>
            <Text c="dimmed" size="sm">
              Создана {formatDate(lead.createdAt)} · активность {formatDate(lead.updatedAt)}
            </Text>
          </Box>
          <Code className="leadCode">{lead.publicSubmissionId}</Code>
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
          <Field label="Телефон" value={lead.contact.phone} />
          <Field label="Email" value={lead.contact.email} />
          <Field label="Город" value={lead.contact.city} />
          <Field label="Предпочтение" value={contactLabel(lead.contact.preferredContact)} />
        </SimpleGrid>

        <Section title="Статус">
          <Group align="flex-end" gap="sm">
            <Select
              className="statusSelect"
              label="Текущий статус"
              data={LEAD_STATUS_OPTIONS}
              value={selectedStatus}
              allowDeselect={false}
              onChange={(value) => {
                if (isLeadStatus(value)) {
                  setSelectedStatus(value);
                }
              }}
            />
            <Button
              leftSection={<Check size={16} />}
              loading={isSaving}
              disabled={isSaving || selectedStatus === lead.status}
              onClick={() => onStatusChange(selectedStatus)}
            >
              Сохранить
            </Button>
          </Group>
          {statusChangeState.status === "error" ? (
            <Alert color="red" variant="light" icon={<AlertCircle size={18} />}>
              {statusChangeState.message}
            </Alert>
          ) : null}
        </Section>

        <Section title="Запрос">
          <Text className="requestText">{lead.request.text ?? "Текст запроса не указан."}</Text>
          {lead.request.productInterest ? (
            <Group gap="xs">
              <Text size="sm" c="dimmed">
                Интерес:
              </Text>
              <Badge variant="outline" color="gray">
                {lead.request.productInterest}
              </Badge>
            </Group>
          ) : null}
        </Section>

        <StructuredIntakeCard
          leadId={lead.leadId}
          intake={lead.structuredIntake}
          canReview={canManageAi}
        />

        {lead.conversations.length ? (
          <Section title="Диалог">
            <Stack gap="md">
              {lead.conversations.map((conversation) => (
                <ConversationHistory
                  key={conversation.publicConversationId}
                  conversation={conversation}
                  takeoverState={takeoverState}
                  canManageAi={canManageAi}
                  onTakeover={onTakeover}
                  onSetConversationAiControl={onSetConversationAiControl}
                />
              ))}
            </Stack>
          </Section>
        ) : null}

        <Section title="Источник">
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            <Field label="Форма" value={formKindLabel(lead.source.formKind)} />
            <Field label="Отправлена" value={formatDate(lead.submittedAt)} />
            {lead.source.channel === "site_widget" ? (
              <Field label="Виджет" value={lead.source.widgetInstanceId} />
            ) : null}
            {lead.source.pageUrl ? (
              <Box className="field mdSpan2">
                <Text size="xs" c="dimmed" fw={700} tt="uppercase">
                  Страница
                </Text>
                <Anchor
                  href={lead.source.pageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="linkLine"
                >
                  <span>{lead.source.pageUrl}</span>
                  <ExternalLink size={14} />
                </Anchor>
              </Box>
            ) : null}
            {lead.source.referrerUrl ? (
              <Box className="field mdSpan2">
                <Text size="xs" c="dimmed" fw={700} tt="uppercase">
                  Источник перехода
                </Text>
                <Anchor
                  href={lead.source.referrerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="linkLine"
                >
                  <span>{lead.source.referrerUrl}</span>
                  <ExternalLink size={14} />
                </Anchor>
              </Box>
            ) : null}
          </SimpleGrid>

          {utmEntries.length ? (
            <Group gap="xs">
              {utmEntries.map(([key, value]) => (
                <Badge key={key} variant="light" color="gray">
                  {key}: {value}
                </Badge>
              ))}
            </Group>
          ) : null}
        </Section>

        <Section title="История">
          <Stack gap="sm">
            {lead.timeline.map((event) => (
              <Group key={`${event.eventType}-${event.createdAt}`} gap="sm" align="flex-start">
                <ThemeIcon variant="light" color={timelineIconColor(event)} size={30} radius="sm">
                  <Clock3 size={16} />
                </ThemeIcon>
                <Box>
                  <Text fw={600} size="sm">
                    {timelineSummaryLabel(event)}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {formatDate(event.createdAt)} · {timelineEventLabel(event.eventType)}
                  </Text>
                </Box>
              </Group>
            ))}
          </Stack>
        </Section>
      </Stack>
    </Paper>
  );
}

function StructuredIntakeCard({
  leadId,
  intake,
  canReview
}: {
  leadId: string;
  intake: ManagerLeadDetail["structuredIntake"];
  canReview: boolean;
}) {
  const [reviewLabels, setReviewLabels] = useState(
    intake.verification?.reviewLabels ?? []
  );
  const [savingLabel, setSavingLabel] = useState<AiReviewLabel | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const hasData =
    intake.slots.length > 0 ||
    intake.requirements.length > 0 ||
    intake.conflicts.length > 0 ||
    Boolean(intake.handoff) ||
    Boolean(intake.verification);

  useEffect(() => {
    setReviewLabels(intake.verification?.reviewLabels ?? []);
    setSavingLabel(null);
    setReviewError(null);
  }, [intake.verification?.aiRunId]);

  const saveReviewLabel = async (label: AiReviewLabel) => {
    if (!intake.verification || savingLabel) {
      return;
    }

    setSavingLabel(label);
    setReviewError(null);

    try {
      const result = await managerApi.recordAiReviewLabel(
        leadId,
        intake.verification.aiRunId,
        label
      );
      setReviewLabels(result.lead.structuredIntake.verification?.reviewLabels ?? []);
    } catch (error) {
      setReviewError(errorMessage(error));
    } finally {
      setSavingLabel(null);
    }
  };

  if (!hasData) {
    return null;
  }

  return (
    <Section title="Собранная заявка">
      {intake.slots.length ? (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
          {intake.slots.map((slot) => (
            <Paper key={`${slot.publicConversationId}-${slot.name}`} withBorder p="sm">
              <Text size="xs" c="dimmed" fw={700} tt="uppercase">
                {structuredIntakeSlotLabel(slot.name)}
              </Text>
              <Text fw={600}>{slot.value}</Text>
              <Text size="xs" c="dimmed">
                {structuredIntakeSourceLabel(slot.source)} · уверенность{" "}
                {Math.round(slot.confidence * 100)}%
              </Text>
              {slot.evidence ? (
                <details>
                  <summary>Показать подтверждение</summary>
                  <Text size="sm" mt={4}>
                    «{slot.evidence.quote}»
                  </Text>
                </details>
              ) : null}
            </Paper>
          ))}
        </SimpleGrid>
      ) : (
        <Text size="sm" c="dimmed">
          AI пока не извлек структурированные параметры.
        </Text>
      )}

      {intake.requirements.length ? (
        <Box>
          <Text size="xs" c="dimmed" fw={700} tt="uppercase" mb={6}>
            Предпочтения и требования
          </Text>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
            {intake.requirements.map((requirement) => (
              <Paper
                key={`${requirement.publicConversationId}-${requirement.category}-${requirement.mode}-${requirement.value}`}
                withBorder
                p="sm"
              >
                <Text size="xs" c="dimmed" fw={700} tt="uppercase">
                  {requirementCategoryLabel(requirement.category)} ·{" "}
                  {requirementModeLabel(requirement.mode)}
                </Text>
                <Text fw={600}>{requirement.value}</Text>
                <Text size="xs" c="dimmed">
                  уверенность {Math.round(requirement.confidence * 100)}%
                </Text>
                <details>
                  <summary>Показать подтверждение</summary>
                  <Text size="sm" mt={4}>
                    «{requirement.evidence.quote}»
                  </Text>
                </details>
              </Paper>
            ))}
          </SimpleGrid>
        </Box>
      ) : null}

      {intake.missingFields.length ? (
        <Box>
          <Text size="xs" c="dimmed" fw={700} tt="uppercase" mb={6}>
            Еще не известно
          </Text>
          <Group gap="xs">
            {intake.missingFields.map((name) => (
              <Badge key={name} variant="outline" color="gray">
                {structuredIntakeSlotLabel(name)}
              </Badge>
            ))}
          </Group>
        </Box>
      ) : null}

      {intake.conflicts.map((conflict) => (
        <Alert
          key={`${conflict.publicConversationId}-${conflict.name}-${conflict.createdAt}`}
          color="orange"
          variant="light"
          icon={<AlertCircle size={18} />}
        >
          Конфликт «{structuredIntakeSlotLabel(conflict.name)}»: AI извлек
          {` «${conflict.candidateValue}»`}
          {conflict.currentValue ? `, текущее значение «${conflict.currentValue}»` : ""}.
          {conflict.evidence ? ` Подтверждение: «${conflict.evidence.quote}».` : ""}
        </Alert>
      ))}

      {intake.handoff ? (
        <Alert color="blue" variant="light" icon={<UserRound size={18} />}>
          Передача менеджеру: {intake.handoff.summary} ({intake.handoff.reason})
        </Alert>
      ) : null}

      {intake.verification ? (
        <Stack gap="xs">
          <Text size="xs" c="dimmed">
            Проверка ответа: {intake.verification.verdict ?? intake.verification.status}
            {intake.verification.verifierModelName
              ? ` · ${intake.verification.verifierModelName}`
              : ""}
            {intake.verification.catalogVersion
              ? ` · каталог ${intake.verification.catalogVersion}`
              : ""}
          </Text>
          {reviewLabels.length ? (
            <Group gap="xs">
              {reviewLabels.map((review) => (
                <Badge key={`${review.label}-${review.createdAt}`} color="blue" variant="light">
                  {aiReviewLabel(review.label)}
                </Badge>
              ))}
            </Group>
          ) : null}
          {canReview ? (
            <Group gap="xs">
              {AI_REVIEW_LABELS.map((label) => (
                <Button
                  key={label}
                  size="compact-xs"
                  variant="subtle"
                  color={label === "correct" ? "green" : "orange"}
                  loading={savingLabel === label}
                  disabled={Boolean(savingLabel) || reviewLabels.some((item) => item.label === label)}
                  onClick={() => void saveReviewLabel(label)}
                >
                  {aiReviewLabel(label)}
                </Button>
              ))}
            </Group>
          ) : null}
          {reviewError ? (
            <Text size="xs" c="red">
              {reviewError}
            </Text>
          ) : null}
        </Stack>
      ) : null}
    </Section>
  );
}

function requirementCategoryLabel(
  category: ManagerLeadDetail["structuredIntake"]["requirements"][number]["category"]
): string {
  return {
    style: "Стиль",
    color: "Цвет",
    shape: "Форма",
    accessory: "Аксессуар",
    decoration: "Оформление",
    site_constraint: "Особенность участка",
    other: "Другое"
  }[category];
}

function requirementModeLabel(
  mode: ManagerLeadDetail["structuredIntake"]["requirements"][number]["mode"]
): string {
  return {
    preference: "предпочтение",
    requirement: "обязательно",
    avoidance: "исключить"
  }[mode];
}

function ConversationHistory({
  conversation,
  takeoverState,
  canManageAi,
  onTakeover,
  onSetConversationAiControl
}: {
  conversation: ManagerLeadDetail["conversations"][number];
  takeoverState: TakeoverState;
  canManageAi: boolean;
  onTakeover: (publicConversationId: string) => void;
  onSetConversationAiControl: (publicConversationId: string, enabled: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const canCollapse = conversation.messages.length > COLLAPSED_DIALOG_MESSAGE_LIMIT;
  const isTakingOver =
    takeoverState.status === "saving" &&
    takeoverState.publicConversationId === conversation.publicConversationId;
  const takeoverError =
    takeoverState.status === "error" &&
    takeoverState.publicConversationId === conversation.publicConversationId
      ? takeoverState.message
      : null;
  const visibleMessages = expanded
    ? conversation.messages
    : conversation.messages.slice(-COLLAPSED_DIALOG_MESSAGE_LIMIT);
  const hiddenCount = conversation.messages.length - visibleMessages.length;

  useEffect(() => {
    setExpanded(true);
  }, [conversation.publicConversationId]);

  return (
    <Stack gap="sm" className="conversationBlock">
      <Group justify="space-between" gap="sm" align="flex-start">
        <Box>
          <Group gap="xs">
            <Badge color="blue" variant="light">
              {conversationChannelLabel(conversation.channel)}
            </Badge>
            <Badge color={conversation.agentAllowedToReply ? "green" : "red"} variant="light">
              {conversation.agentAllowedToReply ? "AI включен" : "AI отключен"}
            </Badge>
            <Badge color="gray" variant="outline">
              {formatMessageCount(conversation.messages.length)}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed" mt={8}>
            {conversation.channel === "site_widget" &&
            conversation.channelIdentity.widgetPublicSessionId ? (
              <>
                Сессия: <Code>{conversation.channelIdentity.widgetPublicSessionId}</Code>
              </>
            ) : (
              <>
                Telegram:{" "}
                <Code>
                  {conversation.channelIdentity.username ??
                    conversation.channelIdentity.externalChatId ??
                    conversation.channelIdentity.provider}
                </Code>
              </>
            )}
          </Text>
        </Box>

        <Group gap="xs" justify="flex-end">
          {canManageAi && conversation.channel === "site_widget" ? (
            <Button
              variant="light"
              size="xs"
              color={conversation.agentAllowedToReply ? "red" : "green"}
              loading={isTakingOver}
              leftSection={
                conversation.agentAllowedToReply ? <BotOff size={14} /> : <Bot size={14} />
              }
              onClick={() =>
                onSetConversationAiControl(
                  conversation.publicConversationId,
                  !conversation.agentAllowedToReply
                )
              }
            >
              {conversation.agentAllowedToReply ? "Остановить AI" : "Включить AI"}
            </Button>
          ) : canManageAi && conversation.agentAllowedToReply ? (
            <Button
              variant="light"
              size="xs"
              color="red"
              loading={isTakingOver}
              leftSection={<BotOff size={14} />}
              onClick={() => onTakeover(conversation.publicConversationId)}
            >
              Взять диалог
            </Button>
          ) : null}
          {canCollapse ? (
            <Button
              variant="subtle"
              size="xs"
              color="gray"
              aria-expanded={expanded}
              leftSection={expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? "Свернуть историю" : "Показать всю историю"}
            </Button>
          ) : null}
        </Group>
      </Group>

      {takeoverError ? (
        <Alert color="red" variant="light" icon={<AlertCircle size={18} />}>
          {takeoverError}
        </Alert>
      ) : null}

      <Stack gap="xs" className="conversationMessages" data-collapsed={!expanded || undefined}>
        {!expanded && hiddenCount > 0 ? (
          <Text size="xs" c="dimmed" className="hiddenMessagesNote">
            Скрыто ранних сообщений: {hiddenCount}
          </Text>
        ) : null}

        {visibleMessages.map((message) => (
          <Box
            key={message.publicMessageId}
            className={`messageBubble messageBubble--${message.direction}`}
          >
            <Group gap="xs" align="center" mb={6}>
              <ThemeIcon
                variant="light"
                color={message.senderRole === "ai_assistant" ? "blue" : "green"}
                size={24}
                radius="sm"
              >
                {message.senderRole === "ai_assistant" ? (
                  <Bot size={14} />
                ) : (
                  <MessageCircle size={14} />
                )}
              </ThemeIcon>
              <Text size="xs" c="dimmed">
                {conversationMessageSenderLabel(message.senderRole)} · {formatDate(message.createdAt)}
              </Text>
              {message.delivery ? (
                <Tooltip label={deliveryTooltip(message.delivery)}>
                  <Badge
                    size="xs"
                    variant="light"
                    color={deliveryStatusColor(message.delivery.status)}
                  >
                    {deliveryStatusLabel(message.delivery.status)}
                  </Badge>
                </Tooltip>
              ) : null}
            </Group>
            <Text className="requestText">{conversationMessageBody(message)}</Text>
          </Box>
        ))}
      </Stack>
    </Stack>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack gap="sm">
      <Title order={3} size="h5">
        {title}
      </Title>
      {children}
    </Stack>
  );
}

function Field({ label, value, code }: { label: string; value?: string; code?: boolean }) {
  return (
    <Box className="field">
      <Text size="xs" c="dimmed" fw={700} tt="uppercase">
        {label}
      </Text>
      {code && value ? (
        <Code>{value}</Code>
      ) : (
        <Text fw={600} className="fieldValue">
          {value || "-"}
        </Text>
      )}
    </Box>
  );
}

function FullPageLoading() {
  return (
    <Box className="loadingScreen">
      <Loader color="green" />
    </Box>
  );
}

function replaceLeadListItem(
  leads: ManagerLeadListItem[],
  updatedLead: ManagerLeadDetail
): ManagerLeadListItem[] {
  const listItem = toLeadListItem(updatedLead);
  let replaced = false;
  const nextLeads = leads.map((lead) => {
    if (lead.leadId !== listItem.leadId) {
      return lead;
    }

    replaced = true;
    return listItem;
  });

  return sortLeadListItems(replaced ? nextLeads : [listItem, ...nextLeads]);
}

function toLeadListItem(lead: ManagerLeadDetail): ManagerLeadListItem {
  return {
    leadId: lead.leadId,
    publicSubmissionId: lead.publicSubmissionId,
    status: lead.status,
    source: lead.source,
    contact: lead.contact,
    request: lead.request,
    submittedAt: lead.submittedAt,
    nextStep: lead.nextStep,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt
  };
}

function sortLeadListItems(leads: ManagerLeadListItem[]) {
  return [...leads].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      right.createdAt.localeCompare(left.createdAt) ||
      right.leadId.localeCompare(left.leadId)
  );
}
