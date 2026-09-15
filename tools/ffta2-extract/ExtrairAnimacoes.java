import org.ruru.ffta2editor.utility.Archive;
import org.ruru.ffta2editor.utility.IdxAndPak;
import org.ruru.ffta2editor.model.unitSst.UnitSst;
import org.ruru.ffta2editor.model.unitSst.UnitAnimation;

import java.io.File;
import java.io.PrintWriter;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.List;

/*
 * ExtrairAnimacoes -- tira do FFTA2 a tabela de animacoes de unidade.
 *
 *   java -cp <classes-do-editor>;. ExtrairAnimacoes <pc.idx> <pc.bin> <saida.json>
 *
 *
 * POR QUE EM JAVA
 *
 * O formato do pc.idx/pc.bin nao e uma tabela simples de offsets: tem tabela
 * de ids codificada, tabela de extras e CRC de nome de arquivo. Reimplementar
 * isso em JS seria trabalhoso e, pior, sujeito a erro silencioso -- um offset
 * torto produz dado plausivel e errado.
 *
 * O editor ja tem esse leitor pronto e testado, e as classes dele sao
 * publicas. Entao chamamos o codigo dele em vez de reescrever: o que sai daqui
 * e exatamente o que o editor mostra na tela.
 *
 *
 * O QUE SAI
 *
 * Um JSON com, para cada unidade, a lista de animacoes; e para cada animacao,
 * os frames com spriteIndex e isMirrored.
 *
 *   spriteIndex  qual pose (o <n>.png exportado) aquele frame usa
 *   isMirrored   se o jogo espelha a pose na horizontal
 *
 * A DURACAO E IGNORADA de proposito: o ivalice usa 200ms fixo por enquanto.
 * O campo existe na ROM (offset 0x02 do frame) e pode ser lido depois.
 */
public class ExtrairAnimacoes {

    public static void main(String[] args) throws Exception {
        if (args.length < 3) {
            System.err.println("uso: ExtrairAnimacoes <pc.idx> <pc.bin> <saida.json>");
            System.exit(1);
        }

        Archive archive = new Archive(new File(args[0]), new File(args[1]));

        ByteBuffer sstIdx = archive.getFile("char/rom/rom_idx/UnitSst.rom_idx");
        ByteBuffer sstPak = archive.getFile("char/rom/pak/UnitSst.pak");
        if (sstIdx == null || sstPak == null) {
            System.err.println("UnitSst nao encontrado no archive");
            System.exit(2);
        }

        IdxAndPak unitSsts = new IdxAndPak("unitSsts", sstIdx, sstPak);
        int total = unitSsts.numFiles();
        System.out.println("unidades no UnitSst.pak: " + total);

        StringBuilder json = new StringBuilder();
        json.append("{\n");
        json.append("  \"nota\": \"Animacoes de unidade do FFTA2, extraidas com o codigo do ffta2-editor. ");
        json.append("spriteIndex e o numero do PNG exportado; isMirrored diz se o jogo espelha a pose. ");
        json.append("A duracao da ROM foi ignorada -- o ivalice usa 200ms fixo.\",\n");
        json.append("  \"unidades\": [\n");

        int comAnim = 0, semAnim = 0;
        boolean primeiraUnidade = true;

        for (int u = 0; u < total; u++) {
            ByteBuffer buf = unitSsts.getFile(u);
            if (buf == null || buf.limit() == 0) { semAnim++; continue; }

            UnitSst sst;
            try {
                sst = new UnitSst(buf);
            } catch (Exception e) {
                semAnim++;
                continue;
            }

            /*
             * As animacoes vivem numa BinaryTree indexada por chave. Nao ha
             * lista de chaves: varremos uma faixa e guardamos o que responder.
             *
             * O limite de 512 e empirico -- as chaves observadas no editor sao
             * baixas, e varrer mais so custa tempo.
             */
            List<String> anims = new ArrayList<>();
            for (int key = 0; key < 512; key++) {
                UnitAnimation anim;
                try {
                    anim = sst.getAnimation(key);
                } catch (Exception e) {
                    continue;
                }
                if (anim == null || anim.frames == null || anim.frames.length == 0) continue;

                StringBuilder fr = new StringBuilder();
                for (int i = 0; i < anim.frames.length; i++) {
                    UnitAnimation.UnitAnimationFrame f = anim.frames[i];
                    if (i > 0) fr.append(", ");
                    fr.append("{\"sprite\": ").append(f.spriteIndex.getValue() & 0xFF);
                    fr.append(", \"flip\": ").append(f.propertyFlags.isMirrored.getValue() ? "true" : "false");
                    fr.append("}");
                }

                anims.add("      {\"key\": " + anim.key
                        + ", \"frames\": [" + fr + "]}");
            }

            if (anims.isEmpty()) { semAnim++; continue; }
            comAnim++;

            if (!primeiraUnidade) json.append(",\n");
            primeiraUnidade = false;
            json.append("    {\n      \"unidade\": ").append(u).append(",\n");
            json.append("      \"animacoes\": [\n");
            json.append(String.join(",\n", anims));
            json.append("\n      ]\n    }");
        }

        json.append("\n  ]\n}\n");

        try (PrintWriter out = new PrintWriter(args[2], "UTF-8")) {
            out.print(json);
        }

        System.out.println("com animacao: " + comAnim + "   sem: " + semAnim);
        System.out.println("-> " + args[2]);
    }
}
