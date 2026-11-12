import { ScrollView, Pressable, Text, StyleSheet } from 'react-native';
import { colores, radios, espaciado } from '../../theme';

export default function CategoriaFiltro({
  categorias = [],
  categoriaSeleccionada = null,
  onSeleccionar,
}) {
  const esTodas = categoriaSeleccionada === null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.lista}
    >
      <Pressable
        onPress={() => onSeleccionar?.(null)}
        accessibilityRole="button"
        accessibilityState={{ selected: esTodas }}
        style={[styles.chip, esTodas && styles.chipActiva]}
      >
        <Text style={[styles.texto, esTodas && styles.textoActivo]}>TODAS</Text>
      </Pressable>

      {categorias.map((cat) => {
        const activa = categoriaSeleccionada === cat.id;
        return (
          <Pressable
            key={cat.id}
            onPress={() => onSeleccionar?.(cat.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: activa }}
            style={[styles.chip, activa && styles.chipActiva]}
          >
            <Text style={[styles.texto, activa && styles.textoActivo]}>
              {cat.nombre}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  lista: {
    gap: espaciado.sm,
    paddingVertical: espaciado.xs,
  },
  chip: {
    minHeight: 40,
    paddingHorizontal: espaciado.lg,
    paddingVertical: espaciado.sm,
    borderRadius: radios.pill,
    backgroundColor: colores.superficie2,
    borderWidth: 1,
    borderColor: colores.borde,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipActiva: {
    backgroundColor: colores.primario,
    borderColor: colores.primario,
  },
  texto: {
    color: colores.textoSuave,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  textoActivo: {
    color: colores.texto,
  },
});
