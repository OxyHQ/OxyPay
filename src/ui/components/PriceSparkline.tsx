/**
 * PriceSparkline — a compact FAIR/USD price card: the current price, the 24h
 * change badge, and a small ~7d line chart drawn with react-native-svg.
 *
 * Degrades gracefully: with no price the card shows an "unavailable" note;
 * with a price but fewer than two history points it shows the price and a
 * "not enough data" caption instead of a broken chart.
 */

import { useMemo, useState } from "react";
import { View, Text, type LayoutChangeEvent } from "react-native";
import Svg, {
  Polyline,
  Path,
  Defs,
  LinearGradient,
  Stop,
  Circle,
} from "react-native-svg";
import { useTheme } from "@oxyhq/bloom/theme";
import { Card } from "./Card";
import { Badge } from "./Badge";
import { FONT_PHUDU_BLACK } from "../../utils/fonts";
import { formatFiatAmount, t } from "../../i18n";
import type { PriceHistoryPoint } from "../../services/market";

/** Chart height in px; width is measured from the container via onLayout. */
const CHART_HEIGHT = 56;
/** Inset (px) so the stroke and end dot never clip at the chart edges. */
const CHART_PADDING = 4;

interface PriceSparklineProps {
  /** Price series, oldest→newest. */
  points: PriceHistoryPoint[];
  /** 24h change as a percentage, or null when it can't be derived. */
  changePct: number | null;
  /** Current FAIR/USD unit price, or null when unavailable. */
  currentPriceUsd: number | null;
}

export function PriceSparkline({
  points,
  changePct,
  currentPriceUsd,
}: PriceSparklineProps) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);

  const lineColor =
    changePct == null || changePct === 0
      ? theme.colors.textSecondary
      : changePct > 0
        ? theme.colors.success
        : theme.colors.error;

  const geometry = useMemo(() => {
    if (width <= 0 || points.length < 2) return null;

    const prices = points.map((point) => point.priceUsd);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min;
    const innerWidth = width - CHART_PADDING * 2;
    const innerHeight = CHART_HEIGHT - CHART_PADDING * 2;
    const stepX = innerWidth / (points.length - 1);

    const coords = points.map((point, index) => ({
      x: CHART_PADDING + index * stepX,
      // Center a flat series (range 0) instead of pinning it to the bottom.
      y:
        CHART_PADDING +
        (1 - (range === 0 ? 0.5 : (point.priceUsd - min) / range)) * innerHeight,
    }));

    const line = coords.map((coord) => `${coord.x},${coord.y}`).join(" ");
    const first = coords[0];
    const last = coords[coords.length - 1];
    const area = `M ${first.x},${CHART_HEIGHT} ${coords
      .map((coord) => `L ${coord.x},${coord.y}`)
      .join(" ")} L ${last.x},${CHART_HEIGHT} Z`;

    return { line, area, last };
  }, [width, points]);

  const priceLabel =
    currentPriceUsd != null ? formatFiatAmount(currentPriceUsd, "USD") : null;
  const changeLabel =
    changePct != null
      ? `${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}%`
      : null;
  const changeVariant =
    changePct == null ? "neutral" : changePct > 0 ? "success" : changePct < 0 ? "error" : "neutral";

  const onChartLayout = (event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  };

  return (
    <Card>
      <View className="p-4">
        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-muted-foreground text-xs font-semibold uppercase">
            {t("overview.priceChart.title")}
          </Text>
          {changeLabel ? (
            <Badge text={changeLabel} variant={changeVariant} size="sm" />
          ) : null}
        </View>

        {priceLabel ? (
          <Text
            className="text-foreground text-2xl"
            style={{ fontFamily: FONT_PHUDU_BLACK }}
          >
            {priceLabel}
          </Text>
        ) : (
          <Text className="text-muted-foreground text-sm">
            {t("overview.priceChart.unavailable")}
          </Text>
        )}

        <View
          onLayout={onChartLayout}
          style={{ height: CHART_HEIGHT }}
          className="mt-3 justify-center"
        >
          {geometry ? (
            <Svg width={width} height={CHART_HEIGHT}>
              <Defs>
                <LinearGradient id="sparklineFill" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={lineColor} stopOpacity={0.22} />
                  <Stop offset="1" stopColor={lineColor} stopOpacity={0} />
                </LinearGradient>
              </Defs>
              <Path d={geometry.area} fill="url(#sparklineFill)" />
              <Polyline
                points={geometry.line}
                fill="none"
                stroke={lineColor}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <Circle
                cx={geometry.last.x}
                cy={geometry.last.y}
                r={3}
                fill={lineColor}
              />
            </Svg>
          ) : priceLabel ? (
            <Text className="text-muted-foreground text-xs">
              {t("overview.priceChart.notEnoughData")}
            </Text>
          ) : null}
        </View>

        <Text className="text-muted-foreground text-[10px] mt-1">
          {t("overview.priceChart.window")}
        </Text>
      </View>
    </Card>
  );
}
