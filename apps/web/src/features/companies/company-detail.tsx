import { For, Loading, Show, createMemo } from "solid-js";

import { Skeleton } from "~/components/ui/feedback/skeleton";
import type { CompanyDetailView } from "~/contracts/companies/views";
import { formatAppDateTime } from "~/domain/time/app-time";
import { companyQuery } from "~/rpc/companies/queries";

import styles from "./companies.module.css";

const CHANNEL_LABELS: Record<
  CompanyDetailView["activities"][number]["channel"],
  string
> = {
  call: "Llamada",
  visit: "Visita",
};

function identityValues(detail: CompanyDetailView) {
  const place = [detail.district, detail.province, detail.department]
    .filter(Boolean)
    .join(", ");
  return [
    { label: "Dirección", value: detail.address },
    { label: "Ubicación", value: place || null },
    { label: "Teléfono", value: detail.phone },
    { label: "Correo", value: detail.email },
  ].filter((entry) => entry.value);
}

export function CompanyDetail(props: { companyId: string }) {
  const detail = createMemo(() => companyQuery(props.companyId));

  return (
    <Loading fallback={<Skeleton height={320} />}>
      <div class={styles.page}>
        <header class={styles.company}>
          <h1 class={styles.title}>{detail().legalName ?? detail().ruc}</h1>
          <span class={styles.meta}>
            RUC {detail().ruc}
            <Show when={detail().lineOfBusiness}>
              {(line) => <> · {line()}</>}
            </Show>
          </span>
        </header>
        <Show when={identityValues(detail()).length > 0}>
          <dl class={styles.values}>
            <For each={identityValues(detail())}>
              {(entry) => (
                <div class={styles.value}>
                  <dt>{entry.label}</dt>
                  <dd>{entry.value}</dd>
                </div>
              )}
            </For>
          </dl>
        </Show>
        <Show
          when={
            detail().cases.length +
              detail().activities.length +
              detail().campaignRecords.length >
            0
          }
          fallback={
            <p class={styles.meta}>Nadie trabajó esta empresa todavía.</p>
          }
        >
          <CompanyCases detail={detail()} />
          <CompanyActivities detail={detail()} />
          <CompanyCampaigns detail={detail()} />
        </Show>
        <CompanyPeople detail={detail()} />
      </div>
    </Loading>
  );
}

function CompanyCases(props: { detail: CompanyDetailView }) {
  return (
    <Show when={props.detail.cases.length > 0}>
      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Casos</h2>
        <ul class={styles.list}>
          <For each={props.detail.cases}>
            {(each) => (
              <li class={styles.item}>
                <a class={styles.link} href={`/cases/${each.id}`}>
                  {each.caseTypeName}
                </a>
                <span class={styles.meta}>
                  Responsable {each.holderName} · Actualizado{" "}
                  {formatAppDateTime(each.updatedAt)}
                </span>
              </li>
            )}
          </For>
        </ul>
      </section>
    </Show>
  );
}

function CompanyActivities(props: { detail: CompanyDetailView }) {
  return (
    <Show when={props.detail.activities.length > 0}>
      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Llamadas y visitas</h2>
        <ul class={styles.list}>
          <For each={props.detail.activities}>
            {(each) => (
              <li class={styles.item}>
                <span class={styles.name}>
                  {CHANNEL_LABELS[each.channel]}
                  <Show when={each.outcomeLabel}>
                    {(label) => <> · {label()}</>}
                  </Show>
                </span>
                <span class={styles.meta}>
                  {each.userName} · {formatAppDateTime(each.startedAt)}
                </span>
                <Show when={each.notes}>
                  {(notes) => <p class={styles.notes}>{notes()}</p>}
                </Show>
              </li>
            )}
          </For>
        </ul>
      </section>
    </Show>
  );
}

function CompanyCampaigns(props: { detail: CompanyDetailView }) {
  return (
    <Show when={props.detail.campaignRecords.length > 0}>
      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Campañas</h2>
        <ul class={styles.list}>
          <For each={props.detail.campaignRecords}>
            {(each) => (
              <li class={styles.item}>
                <span class={styles.name}>
                  {each.campaignName} · {each.segment}
                </span>
                <span class={styles.meta}>{campaignStatus(each)}</span>
              </li>
            )}
          </For>
        </ul>
      </section>
    </Show>
  );
}

function campaignStatus(
  record: CompanyDetailView["campaignRecords"][number],
): string {
  if (record.workedAt !== null) {
    return `Trabajada ${formatAppDateTime(record.workedAt)}`;
  }
  return record.holderName
    ? `En el lote de ${record.holderName}`
    : "Sin asignar";
}

function CompanyPeople(props: { detail: CompanyDetailView }) {
  return (
    <Show when={props.detail.people.length > 0}>
      <section class={styles.section}>
        <h2 class={styles.sectionTitle}>Contactos</h2>
        <ul class={styles.list}>
          <For each={props.detail.people}>
            {(person) => (
              <li class={styles.item}>
                <span class={styles.name}>
                  {person.name}
                  <Show when={person.role}>{(role) => <> · {role()}</>}</Show>
                </span>
                <span class={styles.meta}>
                  {[person.phone, person.email].filter(Boolean).join(" · ")}
                </span>
              </li>
            )}
          </For>
        </ul>
      </section>
    </Show>
  );
}
