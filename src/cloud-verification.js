import { supabase } from "./supabase-client.js";

function ordenarPorId(lista) {
    return lista.sort((a, b) => String(a.id).localeCompare(String(b.id), "pt-BR"));
}

function normalizarDadosLocais(dados) {
    const materias = (dados.materias || []).map((materia, position) => ({
        id: String(materia.id),
        nome: materia.nome || "",
        desc: materia.desc || "",
        cor: materia.cor || "primary",
        prioridade: materia.prioridade || "media",
        position,
        topicos: (materia.topicos || []).map((topico, topicPosition) => ({
            id: String(topico.id),
            titulo: topico.titulo || "",
            status: topico.status || "nao",
            revisoes: Number(topico.revisoes) || 0,
            position: topicPosition
        })),
        notas: ordenarPorId((materia.notas || []).map(nota => ({
            id: String(nota.id),
            titulo: nota.titulo || "",
            conteudo: nota.conteudo || "",
            tags: Array.isArray(nota.tags) ? nota.tags : [],
            fixada: nota.fixada === true
        }))),
        cards: ordenarPorId((materia.cards || []).map(card => ({
            id: String(card.id),
            frente: card.frente || "",
            verso: card.verso || "",
            caixa: Number(card.caixa) || 1,
            proxima: card.proxima || "",
            acertos: Number(card.acertos) || 0,
            erros: Number(card.erros) || 0,
            topicoEditalId: card.topicoEditalId || null
        }))),
        links: ordenarPorId((materia.links || []).map(link => ({
            id: String(link.id),
            titulo: link.titulo || "",
            url: link.url || ""
        })))
    }));

    return {
        materias,
        tarefas: ordenarPorId((dados.tarefas || []).map(tarefa => ({
            id: String(tarefa.id),
            materiaId: String(tarefa.materiaId),
            topico: tarefa.topico || "",
            data: tarefa.data || "",
            status: tarefa.status || "pendente"
        }))),
        edital: {
            nomeConcurso: dados.edital?.nomeConcurso || "",
            banca: dados.edital?.banca || "",
            vagas: dados.edital?.vagas || "",
            dataProva: dados.edital?.dataProva || "",
            materias: ordenarPorId((dados.edital?.materias || []).map(item => ({
                id: String(item.id),
                materiaId: String(item.materiaId),
                questoes: Number(item.questoes) || 0,
                peso: Number(item.peso) || 0,
                topicos: (item.topicos || []).map(topico => ({
                    id: String(topico.id),
                    titulo: topico.titulo || "",
                    concluido: topico.concluido === true
                }))
            })))
        },
        erros: ordenarPorId((dados.erros || []).map(item => ({
            id: String(item.id),
            materiaId: String(item.materiaId),
            tema: item.tema || "",
            obs: item.obs || "",
            data: item.data || ""
        }))),
        desempenho: Object.entries(dados.desempenho || {})
            .map(([materiaId, valor]) => ({
                materiaId: String(materiaId),
                acertos: Number(valor.acertos) || 0,
                total: Number(valor.total) || 0
            }))
            .sort((a, b) => a.materiaId.localeCompare(b.materiaId, "pt-BR"))
    };
}

function exigirResposta(resposta, tabela) {
    if (resposta.error) throw new Error(`Falha ao consultar ${tabela}.`, { cause: resposta.error });
    return resposta.data || [];
}

function criarMapasDeLegado(itens) {
    const mapas = new Map();
    itens.forEach(item => {
        if (!mapas.has(item.entity_type)) mapas.set(item.entity_type, new Map());
        mapas.get(item.entity_type).set(item.new_id, item.legacy_id);
    });
    return mapas;
}

function idLegado(mapas, tipo, novoId) {
    return String(mapas.get(tipo)?.get(novoId) || novoId);
}

function agruparPor(lista, chave) {
    return lista.reduce((grupos, item) => {
        const valor = item[chave];
        if (!grupos.has(valor)) grupos.set(valor, []);
        grupos.get(valor).push(item);
        return grupos;
    }, new Map());
}

async function buscarDadosRemotos(contexto) {
    const loteResposta = await supabase
        .from("migration_batches")
        .select("id, checksum, completed_at")
        .eq("workspace_id", contexto.workspaceId)
        .eq("user_id", contexto.userId)
        .eq("status", "concluido")
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (loteResposta.error || !loteResposta.data) throw new Error("Lote concluído não encontrado.", { cause: loteResposta.error });

    const workspaceId = contexto.workspaceId;
    const userId = contexto.userId;
    const respostas = await Promise.all([
        supabase.from("migration_items").select("entity_type, legacy_id, new_id").eq("batch_id", loteResposta.data.id),
        supabase.from("subjects").select("id, name, description, color, priority, position").eq("workspace_id", workspaceId).order("position"),
        supabase.from("topics").select("id, subject_id, title, status, review_count, position").eq("workspace_id", workspaceId).order("position"),
        supabase.from("notes").select("id, subject_id, title, content, tags, pinned").eq("workspace_id", workspaceId),
        supabase.from("flashcards").select("id, subject_id, front, back").eq("workspace_id", workspaceId),
        supabase.from("flashcard_progress").select("flashcard_id, box, next_review, correct_count, error_count, exam_topic_id").eq("workspace_id", workspaceId).eq("user_id", userId),
        supabase.from("study_links").select("id, subject_id, title, url").eq("workspace_id", workspaceId),
        supabase.from("study_tasks").select("id, subject_id, topic, due_date, status").eq("workspace_id", workspaceId),
        supabase.from("exam_settings").select("exam_name, board_name, vacancies, exam_date").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle(),
        supabase.from("exam_subjects").select("id, subject_id, question_count, weight").eq("workspace_id", workspaceId).eq("user_id", userId),
        supabase.from("exam_topics").select("id, exam_subject_id, title, checked, position").eq("workspace_id", workspaceId).eq("user_id", userId).order("position"),
        supabase.from("error_entries").select("id, subject_id, theme, observation, occurred_on").eq("workspace_id", workspaceId).eq("user_id", userId),
        supabase.from("subject_performance").select("subject_id, correct_answers, total_answers").eq("workspace_id", workspaceId).eq("user_id", userId)
    ]);

    const itens = exigirResposta(respostas[0], "itens de migração");
    const subjects = exigirResposta(respostas[1], "matérias");
    const topics = exigirResposta(respostas[2], "tópicos");
    const notes = exigirResposta(respostas[3], "notas");
    const flashcards = exigirResposta(respostas[4], "flashcards");
    const progress = exigirResposta(respostas[5], "progresso de flashcards");
    const links = exigirResposta(respostas[6], "links");
    const tasks = exigirResposta(respostas[7], "cronograma");
    if (respostas[8].error) throw new Error("Falha ao consultar edital.", { cause: respostas[8].error });
    const examSettings = respostas[8].data;
    const examSubjects = exigirResposta(respostas[9], "itens do edital");
    const examTopics = exigirResposta(respostas[10], "checklist do edital");
    const errors = exigirResposta(respostas[11], "caderno de erros");
    const performance = exigirResposta(respostas[12], "desempenho");
    const mapas = criarMapasDeLegado(itens);
    const topicsBySubject = agruparPor(topics, "subject_id");
    const notesBySubject = agruparPor(notes, "subject_id");
    const cardsBySubject = agruparPor(flashcards, "subject_id");
    const linksBySubject = agruparPor(links, "subject_id");
    const progressByCard = new Map(progress.map(item => [item.flashcard_id, item]));
    const examTopicsBySubject = agruparPor(examTopics, "exam_subject_id");

    return {
        materias: subjects.map(subject => ({
            id: idLegado(mapas, "subject", subject.id),
            nome: subject.name,
            desc: subject.description,
            cor: subject.color,
            prioridade: subject.priority,
            position: Number(subject.position),
            topicos: (topicsBySubject.get(subject.id) || []).map(topic => ({
                id: idLegado(mapas, "topic", topic.id),
                titulo: topic.title,
                status: topic.status,
                revisoes: Number(topic.review_count),
                position: Number(topic.position)
            })),
            notas: ordenarPorId((notesBySubject.get(subject.id) || []).map(note => ({
                id: idLegado(mapas, "note", note.id),
                titulo: note.title,
                conteudo: note.content,
                tags: note.tags || [],
                fixada: note.pinned === true
            }))),
            cards: ordenarPorId((cardsBySubject.get(subject.id) || []).map(card => {
                const cardProgress = progressByCard.get(card.id) || {};
                return {
                    id: idLegado(mapas, "flashcard", card.id),
                    frente: card.front,
                    verso: card.back,
                    caixa: Number(cardProgress.box) || 1,
                    proxima: cardProgress.next_review || "",
                    acertos: Number(cardProgress.correct_count) || 0,
                    erros: Number(cardProgress.error_count) || 0,
                    topicoEditalId: cardProgress.exam_topic_id ? idLegado(mapas, "exam_topic", cardProgress.exam_topic_id) : null
                };
            })),
            links: ordenarPorId((linksBySubject.get(subject.id) || []).map(link => ({
                id: idLegado(mapas, "study_link", link.id),
                titulo: link.title,
                url: link.url
            })))
        })),
        tarefas: ordenarPorId(tasks.map(task => ({
            id: idLegado(mapas, "study_task", task.id),
            materiaId: idLegado(mapas, "subject", task.subject_id),
            topico: task.topic,
            data: task.due_date || "",
            status: task.status
        }))),
        edital: {
            nomeConcurso: examSettings?.exam_name || "",
            banca: examSettings?.board_name || "",
            vagas: examSettings?.vacancies || "",
            dataProva: examSettings?.exam_date || "",
            materias: ordenarPorId(examSubjects.map(item => ({
                id: idLegado(mapas, "exam_subject", item.id),
                materiaId: idLegado(mapas, "subject", item.subject_id),
                questoes: Number(item.question_count) || 0,
                peso: Number(item.weight) || 0,
                topicos: (examTopicsBySubject.get(item.id) || []).map(topico => ({
                    id: idLegado(mapas, "exam_topic", topico.id),
                    titulo: topico.title,
                    concluido: topico.checked === true
                }))
            })))
        },
        erros: ordenarPorId(errors.map(item => ({
            id: idLegado(mapas, "error_entry", item.id),
            materiaId: idLegado(mapas, "subject", item.subject_id),
            tema: item.theme,
            obs: item.observation,
            data: item.occurred_on || ""
        }))),
        desempenho: performance
            .map(item => ({
                materiaId: idLegado(mapas, "subject", item.subject_id),
                acertos: Number(item.correct_answers) || 0,
                total: Number(item.total_answers) || 0
            }))
            .sort((a, b) => a.materiaId.localeCompare(b.materiaId, "pt-BR")),
        lote: loteResposta.data
    };
}

function ordenarObjeto(valor) {
    if (Array.isArray(valor)) return valor.map(ordenarObjeto);
    if (!valor || typeof valor !== "object") return valor;
    return Object.keys(valor).sort().reduce((resultado, chave) => {
        resultado[chave] = ordenarObjeto(valor[chave]);
        return resultado;
    }, {});
}

async function checksum(valor) {
    const bytes = new TextEncoder().encode(JSON.stringify(ordenarObjeto(valor)));
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function conferirConteudoRemoto(contexto, dadosLocais) {
    const local = normalizarDadosLocais(dadosLocais);
    const remoto = await buscarDadosRemotos(contexto);
    const categorias = ["materias", "tarefas", "edital", "erros", "desempenho"];
    const comparacoes = await Promise.all(categorias.map(async categoria => {
        const [localHash, remoteHash] = await Promise.all([checksum(local[categoria]), checksum(remoto[categoria])]);
        return [categoria, localHash === remoteHash];
    }));
    const divergencias = comparacoes.filter(([, igual]) => !igual).map(([categoria]) => categoria);
    const [checksumLocal, checksumRemoto] = await Promise.all([checksum(local), checksum({
        materias: remoto.materias,
        tarefas: remoto.tarefas,
        edital: remoto.edital,
        erros: remoto.erros,
        desempenho: remoto.desempenho
    })]);
    return {
        igual: divergencias.length === 0 && checksumLocal === checksumRemoto,
        divergencias,
        checksumLocal,
        checksumRemoto,
        loteId: remoto.lote.id
    };
}
