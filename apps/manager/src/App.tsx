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
  Check,
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

import { ApiRequestError, AuthRequiredError, managerApi } from "./api";
import {
  LEAD_STATUS_VALUES,
  isLeadStatus,
  type LeadStatus,
  type ManagerLeadDetail,
  type ManagerLeadListItem,
  type ManagerUser
} from "./types";

type SessionState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "error"; message: string }
  | { status: "signed-in"; user: ManagerUser };

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

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeStyle: "short"
});

const LEAD_STATUS_OPTIONS = LEAD_STATUS_VALUES.map((status) => ({
  value: status,
  label: statusLabel(status)
}));

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
      setSession({ status: "signed-in", user: response.user });
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

function ManagerWorkspace({
  user,
  onSignedOut
}: {
  user: ManagerUser;
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
  const leads = leadsState.leads;

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
  }, [loadLeads]);

  useEffect(() => {
    setStatusChangeState({ status: "idle" });

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
  }, [onSignedOut, selectedLeadId]);

  const selectedLead = useMemo(
    () => leads.find((lead) => lead.leadId === selectedLeadId) ?? null,
    [leads, selectedLeadId]
  );

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
          leads: current.leads.map((lead) =>
            lead.leadId === response.lead.leadId ? { ...lead, status: response.lead.status } : lead
          )
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

  const handleLogout = async () => {
    try {
      await managerApi.logout();
    } finally {
      onSignedOut();
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
                      {formatDate(lead.createdAt)}
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
  onStatusChange
}: {
  selectedLead: ManagerLeadListItem | null;
  detailState: DetailState;
  statusChangeState: StatusChangeState;
  onStatusChange: (status: LeadStatus) => void;
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

  if (detailState.status === "loading" || detailState.status === "idle") {
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
    />
  );
}

function LoadedLeadDetail({
  lead,
  statusChangeState,
  onStatusChange
}: {
  lead: ManagerLeadDetail;
  statusChangeState: StatusChangeState;
  onStatusChange: (status: LeadStatus) => void;
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
              Создана {formatDate(lead.createdAt)}
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

        {lead.conversations.length ? (
          <Section title="Диалог">
            <Stack gap="md">
              {lead.conversations.map((conversation) => (
                <Stack key={conversation.publicSessionId} gap="sm" className="conversationBlock">
                  <Group gap="xs">
                    <Badge color="blue" variant="light">
                      Виджет сайта
                    </Badge>
                    <Badge color="gray" variant="light">
                      AI отключен
                    </Badge>
                  </Group>
                  <Text size="xs" c="dimmed">
                    Сессия: <Code>{conversation.publicSessionId}</Code>
                  </Text>
                  <Stack gap="xs">
                    {conversation.messages.map((message) => (
                      <Box key={message.publicMessageId} className="messageBubble">
                        <Group gap="xs" align="center" mb={6}>
                          <ThemeIcon variant="light" color="green" size={24} radius="sm">
                            <MessageCircle size={14} />
                          </ThemeIcon>
                          <Text size="xs" c="dimmed">
                            Посетитель · {formatDate(message.createdAt)}
                          </Text>
                        </Group>
                        <Text className="requestText">{message.body}</Text>
                      </Box>
                    ))}
                  </Stack>
                </Stack>
              ))}
            </Stack>
          </Section>
        ) : null}

        <Section title="Источник">
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            <Field label="Форма" value={formKindLabel(lead.source.formKind)} />
            <Field label="Отправлена" value={formatDate(lead.submittedAt)} />
            <Field label="Виджет" value={lead.source.widgetInstanceId} />
            <Box className="field mdSpan2">
              <Text size="xs" c="dimmed" fw={700} tt="uppercase">
                Страница
              </Text>
              <Anchor href={lead.source.pageUrl} target="_blank" rel="noreferrer" className="linkLine">
                <span>{lead.source.pageUrl}</span>
                <ExternalLink size={14} />
              </Anchor>
            </Box>
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

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return dateFormatter.format(date);
}

function errorMessage(error: unknown) {
  if (error instanceof AuthRequiredError) {
    return "Нужно войти снова";
  }

  if (error instanceof ApiRequestError) {
    if (error.status === 404) {
      return "Заявка не найдена";
    }

    if (error.status === 401 || error.status === 403) {
      return "Нужно войти снова";
    }

    if (error.status >= 500) {
      return "Сервис временно недоступен";
    }

    return "Не удалось загрузить данные";
  }

  return "Не удалось выполнить запрос";
}

function roleLabel(role: ManagerUser["role"]) {
  const labels: Record<ManagerUser["role"], string> = {
    owner: "Владелец",
    manager: "Менеджер",
    viewer: "Просмотр"
  };

  return labels[role];
}

function statusLabel(status: ManagerLeadListItem["status"]) {
  const labels: Record<ManagerLeadListItem["status"], string> = {
    new: "Новая",
    in_progress: "В работе",
    waiting_response: "Ждет ответа",
    closed: "Закрыта",
    duplicate: "Дубль",
    spam: "Спам"
  };

  return labels[status];
}

function statusBadgeColor(status: ManagerLeadListItem["status"]) {
  const colors: Record<ManagerLeadListItem["status"], string> = {
    new: "green",
    in_progress: "blue",
    waiting_response: "yellow",
    closed: "gray",
    duplicate: "orange",
    spam: "red"
  };

  return colors[status];
}

function sourceChannelLabel(channel: ManagerLeadListItem["source"]["channel"]) {
  const labels: Record<ManagerLeadListItem["source"]["channel"], string> = {
    site_form: "Форма сайта",
    site_widget: "Виджет сайта"
  };

  return labels[channel];
}

function formKindLabel(value: string) {
  const labels: Record<string, string> = {
    catalog_request: "Запрос из каталога",
    contact: "Контактная форма",
    site_widget: "Виджет сайта"
  };

  return labels[value] ?? "Форма сайта";
}

function timelineEventLabel(eventType: string) {
  const labels: Record<string, string> = {
    "lead.created_from_site_form": "Заявка создана",
    "lead.created_from_site_widget": "Заявка из виджета",
    "conversation.message_received": "Сообщение получено",
    "lead.status_changed": "Статус изменен"
  };

  return labels[eventType] ?? "Событие заявки";
}

function timelineSummaryLabel(event: ManagerLeadDetail["timeline"][number]) {
  if (event.eventType === "lead.status_changed") {
    const fromStatus = metadataLeadStatus(event.metadata.from_status);
    const toStatus = metadataLeadStatus(event.metadata.to_status);

    if (fromStatus && toStatus) {
      return `Статус изменен: ${statusLabel(fromStatus)} -> ${statusLabel(toStatus)}`;
    }

    if (toStatus) {
      return `Статус изменен на ${statusLabel(toStatus)}`;
    }
  }

  const labels: Record<string, string> = {
    "lead.created_from_site_form": "Заявка создана из формы на сайте",
    "lead.created_from_site_widget": "Заявка создана из виджета сайта",
    "conversation.message_received": "Получено сообщение из виджета"
  };

  return labels[event.eventType] ?? "Событие заявки";
}

function timelineIconColor(event: ManagerLeadDetail["timeline"][number]) {
  if (event.eventType === "lead.status_changed") {
    return "blue";
  }

  if (event.eventType === "conversation.message_received") {
    return "green";
  }

  return "green";
}

function metadataLeadStatus(value: unknown): LeadStatus | null {
  return isLeadStatus(value) ? value : null;
}

function formatLeadCount(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? "заявка"
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? "заявки"
        : "заявок";

  return `${count} ${word}`;
}

function contactLabel(value: ManagerLeadListItem["contact"]["preferredContact"]) {
  const labels: Record<NonNullable<ManagerLeadListItem["contact"]["preferredContact"]>, string> = {
    phone: "телефон",
    whatsapp: "WhatsApp",
    telegram: "Telegram",
    email: "эл. почта"
  };

  return value ? labels[value] : undefined;
}

function displayContactName(lead: ManagerLeadListItem) {
  if (lead.source.channel === "site_widget" && lead.contact.name === "Site visitor") {
    return "Посетитель сайта";
  }

  return lead.contact.name;
}
