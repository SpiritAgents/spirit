/* next/image is not applicable inside next/og's server-rendered ImageResponse. */
/* eslint-disable next/no-img-element */

import { ImageResponse } from "next/og";

import { loadOgFonts } from "./fonts";
import { getOgLogoDataUri } from "./logo";
import { OG_HEIGHT, OG_WIDTH, type OgModel } from "./model";

const CACHE_CONTROL = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

export function getOgSourceText(model: OgModel): string {
  if (model.kind === "home") return model.alt;
  if (model.kind === "section") return model.title;
  if (model.groups.length === 0) return model.title;
  return `${model.groups.join(" / ")}\n${model.title}`;
}

export async function renderOgImage(model: OgModel): Promise<ImageResponse> {
  const { fonts, fontFamily, text } = await loadOgFonts(getOgSourceText(model), model.locale);
  const logoSize = model.kind === "home" ? 107 : model.kind === "section" ? 72 : 57;
  const logo = await getOgLogoDataUri(logoSize);

  if (model.kind === "home") {
    return new ImageResponse(
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#000",
        }}
      >
        <img src={logo} width={107} height={107} alt="" />
      </div>,
      { width: OG_WIDTH, height: OG_HEIGHT, fonts, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }

  if (model.kind === "section") {
    return new ImageResponse(
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#000",
          color: "#fff",
          fontFamily,
        }}
      >
        <img src={logo} width={72} height={72} alt="" />
        <div style={{ display: "block", fontSize: 48, lineHeight: 1.2, whiteSpace: "nowrap" }}>
          {text}
        </div>
      </div>,
      { width: OG_WIDTH, height: OG_HEIGHT, fonts, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }

  const [groupText, ...titleLines] = text.split("\n");
  const title = model.groups.length > 0 ? titleLines.join("\n") : text;
  const eyebrow = model.groups.length > 0 ? groupText : "";
  const explicitTitleLines = title.split("\n");
  const titleStyle = {
    display: "block",
    maxWidth: 1050,
    overflow: "hidden",
    fontSize: 48,
    lineHeight: 1.2,
    textOverflow: "ellipsis",
    wordBreak: "break-word",
  } as const;

  return new ImageResponse(
    <div
      style={{
        position: "relative",
        display: "flex",
        width: "100%",
        height: "100%",
        backgroundColor: "#000",
        color: "#fff",
        fontFamily,
      }}
    >
      <img
        src={logo}
        width={57}
        height={57}
        alt=""
        style={{ position: "absolute", left: 46, top: 39 }}
      />
      <div
        style={{
          position: "absolute",
          left: 61,
          bottom: 116,
          display: "flex",
          flexDirection: "column",
          maxWidth: 1050,
        }}
      >
        {eyebrow ? (
          <div
            style={{
              display: "block",
              maxWidth: 975,
              overflow: "hidden",
              fontSize: 32,
              lineHeight: 1.2,
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {eyebrow}
          </div>
        ) : null}
        {explicitTitleLines.length > 1 ? (
          explicitTitleLines.slice(0, 2).map((line, index) => (
            <div key={index} style={{ ...titleStyle, lineClamp: 1 }}>
              {line}
            </div>
          ))
        ) : (
          <div style={{ ...titleStyle, lineClamp: 2 }}>{title}</div>
        )}
      </div>
    </div>,
    { width: OG_WIDTH, height: OG_HEIGHT, fonts, headers: { "Cache-Control": CACHE_CONTROL } },
  );
}
