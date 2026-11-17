import { useNavigate, useSearchParams } from "@solidjs/router";
import {
  For,
  Loading,
  Show,
  createEffect,
  createMemo,
  createSignal,
} from "solid-js";

import { EmptyState } from "~/components/feedback/empty-state/empty";
import { Skeleton } from "~/components/ui/feedback/skeleton";
import { SearchInput } from "~/components/ui/input/search-input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/layout/table";
import { companiesQuery } from "~/rpc/companies/queries";

import styles from "./companies.module.css";

const SEARCH_DEBOUNCE_MS = 250;

export function CompanySearch() {
  const [search, setSearch] = useSearchParams<{ q?: string }>();
  const text = () => search.q ?? "";
  const [debounced, setDebounced] = createSignal(text().trim());

  createEffect(text, (value) => {
    const normalized = value.trim();
    if (!normalized) {
      setDebounced("");
      return;
    }
    const timeout = setTimeout(
      () => setDebounced(normalized),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timeout);
  });

  return (
    <div class={styles.page}>
      <SearchInput
        value={text()}
        onValueChange={(value) =>
          setSearch({ q: value || null }, { replace: true })
        }
        placeholder="Buscar por RUC o razón social"
        aria-label="Buscar empresas"
      />
      <Loading fallback={<Skeleton height={240} />}>
        <CompanyResults text={debounced()} />
      </Loading>
    </div>
  );
}

function CompanyResults(props: { text: string }) {
  const navigate = useNavigate();
  const companies = createMemo(() => companiesQuery(props.text));

  return (
    <Show
      when={companies().length > 0}
      fallback={
        props.text ? (
          <EmptyState
            title="Sin resultados"
            description="Revisa el RUC o prueba con otra parte de la razón social."
          />
        ) : (
          <EmptyState
            title="Aún no trabajaste empresas"
            description="Las empresas de tus casos, llamadas y campañas aparecen aquí. Busca por RUC o razón social."
          />
        )
      }
    >
      <Table aria-label="Empresas" variant="list">
        <TableHeader>
          <TableRow>
            <TableHead>Empresa</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <For each={companies()}>
            {(company) => {
              const open = () => navigate(`/companies/${company.id}`);
              return (
                <TableRow
                  clickable
                  tabindex={0}
                  onClick={open}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      open();
                    }
                  }}
                >
                  <TableCell>
                    <div class={styles.company}>
                      <span class={styles.name}>
                        {company.legalName ?? company.ruc}
                      </span>
                      <span class={styles.meta}>RUC {company.ruc}</span>
                    </div>
                  </TableCell>
                </TableRow>
              );
            }}
          </For>
        </TableBody>
      </Table>
    </Show>
  );
}
