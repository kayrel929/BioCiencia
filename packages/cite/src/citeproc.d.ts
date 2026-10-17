declare module "citeproc" {
  const CSL: {
    Engine: new (
      sys: { retrieveLocale: (lang: string) => string | null; retrieveItem: (id: string) => unknown },
      style: string,
      lang?: string,
      forceLang?: boolean,
    ) => {
      setOutputFormat(f: "html" | "text" | "rtf"): void;
      updateItems(ids: string[]): void;
      makeBibliography(): [Record<string, any>, string[]] | false;
      makeCitationCluster(items: { id: string }[]): string;
    };
  };
  export default CSL;
}
