// The account chip on the menu: your name and a one-line summary. It opens
// the account panel.

import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import * as stylex from "@stylexjs/stylex";
import { account } from "../../auth.ts";
import { openPanel } from "../../uiState.ts";
import { shallowEqual, useEngine, useSelector } from "../hooks.ts";
import { PersonIcon } from "../icons.tsx";
import { shared } from "../styles.ts";
import { describeAccount } from "./describe.ts";

const styles = stylex.create({
  chip: {
    width: "100%",
    height: "auto",
    justifyContent: "flex-start",
    padding: "8px 14px 8px 8px",
    borderRadius: "10px",
    textAlign: "start",
    backgroundColor: {
      default: "var(--bagarre-hud-panel)",
      ":hover": { default: null, "@media (hover: hover)": "var(--bagarre-hud-panel-hover)" },
    },
  },
  avatar: {
    flexShrink: 0,
    width: "34px",
    height: "34px",
    borderRadius: "var(--radius-full)",
    backgroundColor: "var(--color-background-blue)",
    color: "var(--color-text-blue)",
  },
  text: { minWidth: 0 },
  name: { fontSize: "15px", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
});

export function AccountChip() {
  const { gesture } = useEngine();
  const { name, chipSub } = useSelector(account, describeAccount, shallowEqual);

  return (
    <Button
      label={`Account: ${name}, ${chipSub}`}
      variant="secondary"
      aria-haspopup="dialog"
      data-testid="account-chip"
      xstyle={styles.chip}
      onClick={() => {
        gesture();
        openPanel("account");
      }}
    >
      <HStack as="span" gap={2} align="center">
        <HStack as="span" justify="center" align="center" xstyle={styles.avatar} aria-hidden="true">
          <Icon icon={PersonIcon} size="md" />
        </HStack>
        <VStack as="span" xstyle={styles.text}>
          <Text xstyle={styles.name} color="inherit" data-testid="account-chip-name">
            {name}
          </Text>
          <Text type="supporting" color="secondary" xstyle={shared.tabular}>
            {chipSub}
          </Text>
        </VStack>
      </HStack>
    </Button>
  );
}
