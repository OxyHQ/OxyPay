/**
 * ArrowCircleDownIcon — Material Symbols "arrow_circle_down" (filled), used for
 * the Receive action. Drawn with react-native-svg so it inherits the theme
 * colour like a font icon (`viewBox` is Material Symbols' `0 -960 960 960`).
 */

import Svg, { Path } from "react-native-svg";

interface ArrowCircleDownIconProps {
  color: string;
  size?: number;
}

export function ArrowCircleDownIcon({
  color,
  size = 24,
}: ArrowCircleDownIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 -960 960 960">
      <Path
        fill={color}
        d="m453-438-59-59q-8-8-18-8t-18 8q-8 8-8 18.67 0 10.66 8 18.33l93 93q13 13 30 13t30-13l93-93q8-7.67 8-18.33 0-10.67-8-18.67-8-8-18.67-8-10.66 0-18.33 8l-59 59v-160q0-10.95-8.04-18.97-8.03-8.03-19-8.03-10.96 0-19.46 8.03-8.5 8.02-8.5 18.97v160Zm27.17 338q-79.17 0-148.23-29.89-69.06-29.89-120.57-81.35-51.52-51.46-81.44-120.43Q100-400.65 100-479.83q0-79.17 29.89-148.73 29.89-69.56 81.35-121.07 51.46-51.52 120.43-80.94Q400.65-860 479.83-860q79.17 0 148.73 29.39 69.56 29.39 121.07 80.85 51.52 51.46 80.94 120.93Q860-559.35 860-480.17q0 79.17-29.39 148.23-29.39 69.06-80.85 120.57-51.46 51.52-120.93 81.44Q559.35-100 480.17-100Z"
      />
    </Svg>
  );
}
